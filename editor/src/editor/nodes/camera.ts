import { Node, FreeCamera, Scene, Vector3, Observable } from "babylonjs";
import { EditorFreeCameraPanInput } from "./camera-pan-input";

import { isDomTextInputFocused } from "../../tools/dom";

const DEFAULT_KEYS = {
	keysUp: [87], // W - Forward
	keysDown: [83], // S - Backward
	keysLeft: [65], // A - Left
	keysRight: [68], // D - Right
	keysUpward: [69], // E - Up
	keysDownward: [81], // Q - Down
};

export const CAMERA_SPEED_KEY_PRESETS: Record<string, number> = {
	"1": 15,
	"2": 40,
	"3": 100,
	"4": 300,
	"5": 1000,
	"6": 3000,
};

export class EditorCamera extends FreeCamera {
	private _baseSpeed: number = 100;
	private _boostMultiplier: number = 5.0;
	private _isShiftPressed: boolean = false;
	private _panInput: EditorFreeCameraPanInput;

	private _isAttached: boolean = false;
	private _isControlDown: boolean = false;
	private _noPreventDefault: boolean | undefined = undefined;

	private _keyboardUpListener: (ev: KeyboardEvent) => void;
	private _keyboardDownListener: (ev: KeyboardEvent) => void;
	private _blurListener: () => void;
	private _wheelListener: ((ev: WheelEvent) => void) | null = null;
	private _canvasElement: HTMLCanvasElement | null = null;

	public onSpeedChangedObservable: Observable<number> = new Observable<number>();

	/**
	 * Constructor.
	 * @param name defines the name of the camera.
	 * @param position defines the start position of the camera.
	 * @param scene defines the reference to the scene where to add the camera.
	 * @param setActiveOnSceneIfNoneActive defines wether or not camera should be set as active
	 */
	public constructor(name: string, position: Vector3, scene: Scene, setActiveOnSceneIfNoneActive?: boolean) {
		super(name, position, scene, setActiveOnSceneIfNoneActive);

		this._setDefaultKeys();

		this.inputs.addMouseWheel();
		this._panInput = new EditorFreeCameraPanInput();

		window.addEventListener(
			"keydown",
			(this._keyboardDownListener = (ev) => {
				if ((ev.ctrlKey || ev.metaKey) && !this._isControlDown && this._isAttached) {
					this._isControlDown = true;
					return super.detachControl();
				}

				if (isDomTextInputFocused()) {
					return;
				}

				// Speed Level Hotkeys 1-6 (when camera attached and no modifier keys)
				if (this._isAttached && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
					if (CAMERA_SPEED_KEY_PRESETS[ev.key] !== undefined) {
						this.baseSpeed = CAMERA_SPEED_KEY_PRESETS[ev.key];
						return;
					}
				}

				// Shift: Speed Boost / Turbo
				if (ev.key === "Shift") {
					if (!this._isShiftPressed) {
						this._isShiftPressed = true;
						this.speed = this._baseSpeed * this._boostMultiplier;
						this.onSpeedChangedObservable.notifyObservers(this.speed);
					}
					return;
				}
			})
		);

		window.addEventListener(
			"keyup",
			(this._keyboardUpListener = (ev) => {
				if (!ev.ctrlKey && !ev.metaKey && this._isControlDown && this._isAttached) {
					this._isControlDown = false;
					return super.attachControl(this._noPreventDefault);
				}

				if (ev.key === "Shift") {
					if (this._isShiftPressed) {
						this._isShiftPressed = false;
						this.speed = this._baseSpeed;
						this.onSpeedChangedObservable.notifyObservers(this.speed);
					}
					return;
				}
			})
		);

		window.addEventListener("blur", (this._blurListener = () => {
			if (this._isShiftPressed) {
				this._isShiftPressed = false;
				this.speed = this._baseSpeed;
				this.onSpeedChangedObservable.notifyObservers(this.speed);
			}
		}));
	}

	public get baseSpeed(): number {
		return this._baseSpeed;
	}

	public set baseSpeed(value: number) {
		const clamped = Math.max(0.5, Math.min(20000, value));
		this._baseSpeed = clamped;
		this.speed = this._isShiftPressed ? clamped * this._boostMultiplier : clamped;
		try {
			localStorage.setItem("editor-camera-speed", clamped.toString());
		} catch {}
		this.onSpeedChangedObservable.notifyObservers(this.speed);
	}

	public get boostMultiplier(): number {
		return this._boostMultiplier;
	}

	public set boostMultiplier(value: number) {
		const clamped = Math.max(1.0, Math.min(20, value));
		this._boostMultiplier = clamped;
		if (this._isShiftPressed) {
			this.speed = this._baseSpeed * clamped;
		}
		try {
			localStorage.setItem("editor-camera-boost", clamped.toString());
		} catch {}
		this.onSpeedChangedObservable.notifyObservers(this.speed);
	}

	public get isShiftPressed(): boolean {
		return this._isShiftPressed;
	}

	/**
	 * Override attachControl to ensure pan input is attached
	 */
	public attachControl(noPreventDefault?: boolean): void {
		this._isAttached = true;
		this._noPreventDefault = noPreventDefault;

		super.attachControl(noPreventDefault);

		// Add pan input after camera is attached
		if (this._panInput && !this.inputs.attached.editorPan) {
			this.inputs.add(this._panInput);
		}

		// Attach mouse wheel while holding right-click to adjust speed
		const canvas = (this.getScene()?.getEngine()?.inputElement as HTMLCanvasElement) ?? null;
		if (canvas && canvas !== this._canvasElement) {
			if (this._canvasElement && this._wheelListener) {
				this._canvasElement.removeEventListener("wheel", this._wheelListener);
			}
			this._canvasElement = canvas;
			this._wheelListener = (ev: WheelEvent) => {
				// While right mouse button is held (navigating / flying):
				if (ev.buttons === 2) {
					ev.preventDefault();
					ev.stopPropagation();
					const factor = ev.deltaY < 0 ? 1.15 : 1 / 1.15;
					this.baseSpeed = Math.max(0.5, Math.min(20000, Math.round(this.baseSpeed * factor)));
				}
			};
			canvas.addEventListener("wheel", this._wheelListener, { passive: false });
		}
	}

	public detachControl(): void {
		this._isAttached = false;
		if (this._canvasElement && this._wheelListener) {
			this._canvasElement.removeEventListener("wheel", this._wheelListener);
			this._wheelListener = null;
			this._canvasElement = null;
		}
		super.detachControl();
	}

	/**
	 * Some preferences for the editor's camera are saved in the local storage in order
	 * to be global for each project. This function tries to get the preferences from the local storage
	 * and applies it to the camera.
	 */
	public configureFromPreferences(): void {
		try {
			const savedSpeed = localStorage.getItem("editor-camera-speed");
			if (savedSpeed) {
				const val = parseFloat(savedSpeed);
				if (!isNaN(val) && val > 0) {
					this._baseSpeed = val;
					this.speed = val;
				}
			}

			const savedBoost = localStorage.getItem("editor-camera-boost");
			if (savedBoost) {
				const val = parseFloat(savedBoost);
				if (!isNaN(val) && val >= 1) {
					this._boostMultiplier = val;
				}
			}

			const keys = JSON.parse(localStorage.getItem("editor-camera-controls") as string);
			if (keys && keys.keysUp && keys.keysDown && keys.keysLeft && keys.keysRight && keys.keysUpward && keys.keysDownward) {
				this.keysUp = keys.keysUp;
				this.keysDown = keys.keysDown;
				this.keysLeft = keys.keysLeft;
				this.keysRight = keys.keysRight;
				this.keysUpward = keys.keysUpward;
				this.keysDownward = keys.keysDownward;
			} else {
				this._setDefaultKeysFromLayout();
			}

			// Load pan sensitivity multiplier if available
			if (keys && keys.panSensitivityMultiplier !== undefined) {
				this.panSensitivityMultiplier = keys.panSensitivityMultiplier;
			}
		} catch (e) {
			// If no preferences found or error occurred, use defaults
			this._setDefaultKeysFromLayout();
		}
	}

	/**
	 * Destroy the camera and release the current resources hold by it.
	 */
	public dispose(): void {
		super.dispose();

		if (this._canvasElement && this._wheelListener) {
			this._canvasElement.removeEventListener("wheel", this._wheelListener);
			this._wheelListener = null;
			this._canvasElement = null;
		}

		window.removeEventListener("keyup", this._keyboardUpListener);
		window.removeEventListener("keydown", this._keyboardDownListener);
		window.removeEventListener("blur", this._blurListener);
		this.onSpeedChangedObservable.clear();
	}

	/**
	 * Gets the current object class name.
	 * @return the class name
	 */
	public getClassName(): string {
		return "EditorCamera";
	}

	/**
	 * Gets the pan sensitivity multiplier for the camera pan input.
	 * @returns the current pan sensitivity multiplier value.
	 */
	public get panSensitivityMultiplier(): number {
		return this._panInput.panSensitivityMultiplier;
	}

	/**
	 * Sets the pan sensitivity multiplier for the camera pan input.
	 * @param value defines the new pan sensitivity multiplier value.
	 */
	public set panSensitivityMultiplier(value: number) {
		this._panInput.panSensitivityMultiplier = value;
	}

	private _setDefaultKeys(): void {
		this.keysUp = DEFAULT_KEYS.keysUp;
		this.keysDown = DEFAULT_KEYS.keysDown;
		this.keysLeft = DEFAULT_KEYS.keysLeft;
		this.keysRight = DEFAULT_KEYS.keysRight;
		this.keysUpward = DEFAULT_KEYS.keysUpward;
		this.keysDownward = DEFAULT_KEYS.keysDownward;
	}

	private _setDefaultKeysFromLayout(): void {
		this._setDefaultKeys();

		navigator.keyboard?.getLayoutMap().then((layout) => {
			const keyUp = layout.get("KeyW")?.toUpperCase().charCodeAt(0);
			if (keyUp) {
				this.keysUp = [keyUp];
			}

			const keyDown = layout.get("KeyS")?.toUpperCase().charCodeAt(0);
			if (keyDown) {
				this.keysDown = [keyDown];
			}

			const keyLeft = layout.get("KeyA")?.toUpperCase().charCodeAt(0);
			if (keyLeft) {
				this.keysLeft = [keyLeft];
			}

			const keyRight = layout.get("KeyD")?.toUpperCase().charCodeAt(0);
			if (keyRight) {
				this.keysRight = [keyRight];
			}

			const keyUpward = layout.get("KeyE")?.toUpperCase().charCodeAt(0);
			if (keyUpward) {
				this.keysUpward = [keyUpward];
			}

			const keyDownward = layout.get("KeyQ")?.toUpperCase().charCodeAt(0);
			if (keyDownward) {
				this.keysDownward = [keyDownward];
			}
		});
	}
}

Node.AddNodeConstructor("EditorCamera", (name, scene) => {
	return () => new EditorCamera(name, Vector3.Zero(), scene);
});
