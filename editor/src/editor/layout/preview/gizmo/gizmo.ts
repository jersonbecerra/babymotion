import {
	ActionManager,
	ExecuteCodeAction,
	GizmoCoordinatesMode,
	Node,
	Observable,
	PositionGizmo,
	Quaternion,
	RotationGizmo,
	ScaleGizmo,
	Scene,
	Tools,
	UtilityLayerRenderer,
	Vector3,
	CameraGizmo,
	AbstractMesh,
	TransformNode,
	Sprite,
	LightGizmo,
	LinesMesh,
	MeshBuilder,
	Color3,
	Light,
	Mesh,
	PointerDragBehavior,
	StandardMaterial,
	Nullable,
	SpotLight,
} from "babylonjs";

import { isSprite } from "../../../../tools/guards/sprites";
import { registerUndoRedo } from "../../../../tools/undoredo";
import { isNodeLocked } from "../../../../tools/node/metadata";
import { isQuaternion, isVector3 } from "../../../../tools/guards/math";
import { onNodeModifiedObservable } from "../../../../tools/observables";
import { updateIblShadowsRenderPipeline } from "../../../../tools/light/ibl";
import { markVolumetricLightsDirty } from "../../../rendering/volumetric-lighting";
import { defaultGizmoSnapPreferences, IGizmoSnapPreferences } from "../../../../tools/scene/gizmo";
import { isAbstractMesh, isCamera, isDirectionalLight, isHemisphericLight, isLight, isNode, isPointLight, isSpotLight } from "../../../../tools/guards/nodes";
import { updateLightShadowMapRefreshRate, updatePointLightShadowMapRenderListPredicate } from "../../../../tools/light/shadows";

import { checkMagnetism, resetMagnetism } from "./magnetism";

export const onGizmoNodeChangedObservable = new Observable<Node | Sprite>();

export class EditorPreviewGizmo {
	/**
	 * @internal
	 */
	public _gizmosLayer: UtilityLayerRenderer;

	public _scalingGizmo: ScaleGizmo | null = null;
	public _positionGizmo: PositionGizmo | null = null;
	public _rotationGizmo: RotationGizmo | null = null;

	private _coordinatesMode: GizmoCoordinatesMode = GizmoCoordinatesMode.Local;

	private _cameraGizmo: CameraGizmo | null = null;
	private _lightGizmo: LightGizmo | null = null;
	private _lightHelperMesh: LinesMesh | null = null;
	private _lightHandleMeshes: Mesh[] = [];
	private _isDraggingLightHandle: boolean = false;
	private _handleRangeMaterial: Nullable<StandardMaterial> = null;
	private _handleAngleMaterial: Nullable<StandardMaterial> = null;
	private _handleSoftnessMaterial: Nullable<StandardMaterial> = null;
	private _handleHoverMaterial: Nullable<StandardMaterial> = null;

	private _attachedNode: Node | null = null;
	private _attachedSprite: Sprite | null = null;
	private _attachedLight: Light | null = null;

	private _spriteTransformNode: TransformNode;
	private _lightTransformNode: TransformNode;

	private _snapPreferences: IGizmoSnapPreferences = { ...defaultGizmoSnapPreferences };

	private _keyUpListener: (ev: KeyboardEvent) => void;
	private _keyDownListener: (ev: KeyboardEvent) => void;

	private _nodeModifiedObserver: any = null;
	private _gizmoNodeChangedObserver: any = null;
	private _beforeRenderObserver: any = null;

	public _shiftDown: boolean = false;

	public constructor(scene: Scene) {
		this._gizmosLayer = new UtilityLayerRenderer(scene);
		this._gizmosLayer.utilityLayerScene.postProcessesEnabled = false;

		this._spriteTransformNode = new TransformNode("spriteGizmoTransformNode", this._gizmosLayer.utilityLayerScene);
		this._lightTransformNode = new TransformNode("lightGizmoTransformNode", this._gizmosLayer.utilityLayerScene);
		this._lightTransformNode.rotationQuaternion = new Quaternion();

		this._gizmoNodeChangedObserver = onGizmoNodeChangedObservable.add((node) => {
			if (this._attachedLight && node === this._attachedLight) {
				this._syncLightTransformNode();
				if (!this._isDraggingLightHandle) {
					this._updateLightHelper(this._attachedLight);
				}
			}
		});

		this._nodeModifiedObserver = onNodeModifiedObservable.add((node) => {
			if (this._attachedLight && node === this._attachedLight) {
				this._syncLightTransformNode();
				if (!this._isDraggingLightHandle) {
					this._updateLightHelper(this._attachedLight);
				}
			}
		});

		this._beforeRenderObserver = scene.onBeforeRenderObservable.add(() => {
			if (this._attachedLight && this._lightHelperMesh) {
				this._syncLightTransformNode();
			}
		});

		window.addEventListener(
			"keydown",
			(this._keyDownListener = (ev) => {
				this._shiftDown = ev.shiftKey;
			})
		);
		window.addEventListener(
			"keyup",
			(this._keyUpListener = (ev) => {
				this._shiftDown = ev.shiftKey;
			})
		);

		scene.onDisposeObservable.addOnce(() => {
			window.removeEventListener("keyup", this._keyUpListener);
			window.removeEventListener("keydown", this._keyDownListener);
			this._gizmoNodeChangedObserver?.remove();
			this._nodeModifiedObserver?.remove();
			this._beforeRenderObserver?.remove();
			this._disposeLightHelper();
			this._lightGizmo?.dispose();
			this._handleRangeMaterial?.dispose();
			this._handleAngleMaterial?.dispose();
			this._handleSoftnessMaterial?.dispose();
			this._handleHoverMaterial?.dispose();
		});
	}

	/**
	 * Gets the current gizmo.
	 */
	public get currentGizmo(): PositionGizmo | RotationGizmo | ScaleGizmo | null {
		return this._positionGizmo ?? this._rotationGizmo ?? this._scalingGizmo ?? null;
	}

	/**
	 * Sets the gizmo type.
	 * @param gizmo The gizmo to set.
	 */
	public setGizmoType(gizmo: "position" | "rotation" | "scaling" | "none"): void {
		this.currentGizmo?.dispose();

		this._scalingGizmo = null;
		this._positionGizmo = null;
		this._rotationGizmo = null;

		switch (gizmo) {
			case "position":
				this._positionGizmo = new PositionGizmo(this._gizmosLayer);
				this._positionGizmo.planarGizmoEnabled = true;
				this._attachVector3UndoRedoEvents(this._positionGizmo, "position");
				break;
			case "rotation":
				this._rotationGizmo = new RotationGizmo(this._gizmosLayer);
				this._attachRotationUndoRedoEvents(this._rotationGizmo);
				break;
			case "scaling":
				this._scalingGizmo = new ScaleGizmo(this._gizmosLayer);
				this._attachVector3UndoRedoEvents(this._scalingGizmo, "scaling");
				break;
		}

		if (this.currentGizmo) {
			this.currentGizmo.scaleRatio = 2;
			this.currentGizmo.coordinatesMode = this._coordinatesMode;

			if (this._positionGizmo) {
				// A bit of hacking.
				this._positionGizmo.xPlaneGizmo.coloredMaterial.alpha = 0.3;
				this._positionGizmo.xPlaneGizmo.hoverMaterial.alpha = 1;

				this._positionGizmo.yPlaneGizmo.coloredMaterial.alpha = 0.3;
				this._positionGizmo.yPlaneGizmo.hoverMaterial.alpha = 1;

				this._positionGizmo.zPlaneGizmo.coloredMaterial.alpha = 0.3;
				this._positionGizmo.zPlaneGizmo.hoverMaterial.alpha = 1;
			}
		}

		this._spriteTransformNode.billboardMode = this._scalingGizmo || this._rotationGizmo ? TransformNode.BILLBOARDMODE_ALL : TransformNode.BILLBOARDMODE_NONE;

		this.setAttachedObject(this._attachedSprite ?? this._attachedNode);
		this._applySnapToCurrentGizmos();
	}

	public getSnapPreferences(): IGizmoSnapPreferences {
		return { ...this._snapPreferences };
	}

	public setSnapPreferences(prefs: IGizmoSnapPreferences): void {
		this._snapPreferences = { ...prefs };
		this._applySnapToCurrentGizmos();
	}

	private _applySnapToCurrentGizmos(): void {
		if (this._positionGizmo) {
			const enabled = this._snapPreferences.translationEnabled && this._snapPreferences.translationStep > 0;
			this._positionGizmo.snapDistance = enabled ? this._snapPreferences.translationStep : 0;
		}

		if (this._rotationGizmo) {
			const enabled = this._snapPreferences.rotationEnabled && this._snapPreferences.rotationStepDegrees > 0;
			this._rotationGizmo.snapDistance = enabled ? Tools.ToRadians(this._snapPreferences.rotationStepDegrees) : 0;
		}

		if (this._scalingGizmo) {
			const enabled = this._snapPreferences.scaleEnabled && this._snapPreferences.scaleStep > 0;
			this._scalingGizmo.incrementalSnap = true;
			this._scalingGizmo.snapDistance = enabled ? this._snapPreferences.scaleStep : 0;
		}
	}

	/**
	 * Gets the reference to the node that is attached and controlled by the gizmo.
	 */
	public get attachedNode(): Node | null {
		return this._attachedNode;
	}

	/**
	 * Gets the reference to the sprite that is attached and controlled by the gizmo.
	 */
	public get attachedSprite(): Sprite | null {
		return this._attachedSprite;
	}

	/**
	 * Sets the node that is attached and controlled by the gizmo.
	 * @param object The node to attach to the gizmo.
	 */
	public setAttachedObject(object: Node | Sprite | null): void {
		if (object && isNode(object) && isNodeLocked(object)) {
			object = null;
		}

		this._attachedNode = null;
		this._attachedSprite = null;
		this._attachedLight = null;

		if (object) {
			if (isNode(object)) {
				this._attachedNode = object;
				this._attachedSprite = null;

				if (isLight(object)) {
					this._attachedLight = object;
				}
			} else if (isSprite(object)) {
				this._attachedSprite = object;
				this._attachedNode = this._spriteTransformNode;

				this._spriteTransformNode.position.copyFrom(object.position);
				this._spriteTransformNode.scaling.set(object.width, object.height, 1);
				this._spriteTransformNode.rotation.set(0, 0, object.angle);
			}
		}

		if (object && isCamera(object) && this._gizmosLayer.originalScene.cameras.includes(object)) {
			this._cameraGizmo ??= new CameraGizmo(this._gizmosLayer);
			this._cameraGizmo.camera = object;
			this._cameraGizmo.attachedNode = object;
		} else {
			this._cameraGizmo?.dispose();
			this._cameraGizmo = null;
		}

		if (object && isLight(object) && this._gizmosLayer.originalScene.lights.includes(object)) {
			this._lightGizmo ??= new LightGizmo(this._gizmosLayer);
			this._lightGizmo.light = object;
			this._syncLightTransformNode();
			this._updateLightHelper(object);
		} else {
			this._lightGizmo?.dispose();
			this._lightGizmo = null;
			this._disposeLightHelper();
		}

		if (this.currentGizmo) {
			this.currentGizmo.xGizmo.isEnabled = true;
			this.currentGizmo.yGizmo.isEnabled = true;
			this.currentGizmo.zGizmo.isEnabled = true;

			if (this._attachedLight) {
				if (this._rotationGizmo) {
					if (isPointLight(this._attachedLight)) {
						this.currentGizmo.attachedNode = null;
					} else {
						this._syncLightTransformNode();
						this.currentGizmo.attachedNode = this._lightTransformNode;
					}
				} else if (this._positionGizmo) {
					if (isHemisphericLight(this._attachedLight)) {
						this.currentGizmo.attachedNode = null;
					} else {
						this.currentGizmo.attachedNode = this._attachedLight;
					}
				} else if (this._scalingGizmo) {
					if (isHemisphericLight(this._attachedLight) || isDirectionalLight(this._attachedLight)) {
						this.currentGizmo.attachedNode = null;
					} else {
						this._syncLightTransformNode();
						this._lightTransformNode.scaling.set(1, 1, 1);
						this.currentGizmo.attachedNode = this._lightTransformNode;
					}
				}
			} else {
				this.currentGizmo.attachedNode = this._attachedNode;
			}

			if (object && isSprite(object)) {
				if (this._scalingGizmo) {
					this.currentGizmo.zGizmo.isEnabled = false;
				}

				if (this._rotationGizmo) {
					this.currentGizmo.xGizmo.isEnabled = false;
					this.currentGizmo.yGizmo.isEnabled = false;
				}
			}
		}
	}

	public getCoordinateMode(): GizmoCoordinatesMode {
		return this._coordinatesMode;
	}

	public setCoordinatesMode(mode: GizmoCoordinatesMode): void {
		this._coordinatesMode = mode;

		if (this.currentGizmo) {
			this.currentGizmo.coordinatesMode = mode;
		}
	}

	public getCoordinatesModeString(): string {
		switch (this._coordinatesMode) {
			case GizmoCoordinatesMode.World:
				return "World";
			case GizmoCoordinatesMode.Local:
				return "Local";
		}
	}

	private _updateShadowMapsForMesh(mesh: AbstractMesh): void {
		const scene = this._gizmosLayer.originalScene;
		const lights = scene.lights.filter((light) => light.getShadowGenerator()?.getShadowMap()?.renderList?.includes(mesh));

		lights.forEach((light) => {
			updateLightShadowMapRefreshRate(light);
			updatePointLightShadowMapRenderListPredicate(light);
		});
	}

	private _attachVector3UndoRedoEvents(gizmo: PositionGizmo | ScaleGizmo | RotationGizmo, property: "position" | "scaling"): void {
		let temporaryNode: Node | null = null;
		let temporarySprite: Sprite | null = null;

		let temporaryOldValue: Vector3 | null = null;
		let temporaryLightOldAngle: number | null = null;
		let temporaryLightOldInnerAngle: number | null = null;
		let temporaryLightOldRange: number | null = null;

		gizmo.onDragStartObservable.add(() => {
			resetMagnetism();

			if (!this._attachedNode) {
				return;
			}

			temporaryNode = this._attachedLight && property === "scaling" ? this._lightTransformNode : this._attachedNode;
			temporarySprite = this._attachedSprite;

			if (this._attachedLight && property === "scaling") {
				const light = this._attachedLight;
				temporaryLightOldAngle = isSpotLight(light) ? light.angle : null;
				temporaryLightOldInnerAngle = isSpotLight(light) ? (light.innerAngle ?? null) : null;
				temporaryLightOldRange = light.range;
				this._lightTransformNode.scaling.set(1, 1, 1);
			}

			const value = temporaryNode[property];
			temporaryOldValue = isVector3(value) ? value.clone() : value;
		});

		gizmo.onDragObservable.add(() => {
			if (this._attachedLight && property === "scaling") {
				const light = this._attachedLight;
				const sx = this._lightTransformNode.scaling.x;
				const sy = this._lightTransformNode.scaling.y;
				const sz = this._lightTransformNode.scaling.z;

				if (isSpotLight(light)) {
					const scaleXY = sx !== 1 ? sx : sy;
					if (scaleXY !== 1) {
						light.angle = Math.min(Math.PI * 0.95, Math.max(0.05, light.angle * scaleXY));
						if (light.innerAngle && light.innerAngle >= light.angle) {
							light.innerAngle = light.angle * 0.8;
						}
					}
					if (sz !== 1) {
						const curR = light.range > 0 && light.range < 500 ? light.range : 15;
						light.range = Math.max(0.5, Math.min(500, curR * sz));
					}
				} else if (isPointLight(light)) {
					const scale = (sx + sy + sz) / 3;
					if (scale !== 1) {
						const curR = light.range > 0 && light.range < 500 ? light.range : 5;
						light.range = Math.max(0.5, Math.min(500, curR * scale));
					}
				}
				this._lightTransformNode.scaling.set(1, 1, 1);
				this._updateLightHelper(light);
				updateLightShadowMapRefreshRate(light);
				updatePointLightShadowMapRenderListPredicate(light);
				markVolumetricLightsDirty();
				onGizmoNodeChangedObservable.notifyObservers(light);
			} else if (isLight(temporaryNode)) {
				updateLightShadowMapRefreshRate(temporaryNode);
				updatePointLightShadowMapRenderListPredicate(temporaryNode);
				this._syncLightTransformNode();
				markVolumetricLightsDirty();
			} else if (isAbstractMesh(temporaryNode)) {
				checkMagnetism(this, temporaryNode);
				this._updateShadowMapsForMesh(temporaryNode);
			} else if (temporarySprite) {
				if (property === "scaling") {
					temporarySprite.width = this._spriteTransformNode.scaling.x;
					temporarySprite.height = this._spriteTransformNode.scaling.y;
				} else {
					temporarySprite.position.copyFrom(this._spriteTransformNode.position);
				}
			}
		});

		gizmo.onDragEndObservable.add(() => {
			resetMagnetism();

			if (!temporaryNode) {
				return;
			}

			if (this._attachedLight && property === "scaling") {
				const light = this._attachedLight;
				const oldAngle = temporaryLightOldAngle;
				const oldInnerAngle = temporaryLightOldInnerAngle;
				const oldRange = temporaryLightOldRange;
				const newAngle = isSpotLight(light) ? light.angle : null;
				const newInnerAngle = isSpotLight(light) ? (light.innerAngle ?? null) : null;
				const newRange = light.range;

				registerUndoRedo({
					undo: () => {
						if (oldAngle !== null && isSpotLight(light)) {
							light.angle = oldAngle;
						}
						if (oldInnerAngle !== null && isSpotLight(light)) {
							light.innerAngle = oldInnerAngle;
						}
						if (oldRange !== null) {
							light.range = oldRange;
						}
						this._updateLightHelper(light);
						onGizmoNodeChangedObservable.notifyObservers(light);
					},
					redo: () => {
						if (newAngle !== null && isSpotLight(light)) {
							light.angle = newAngle;
						}
						if (newInnerAngle !== null && isSpotLight(light)) {
							light.innerAngle = newInnerAngle;
						}
						if (newRange !== null) {
							light.range = newRange;
						}
						this._updateLightHelper(light);
						onGizmoNodeChangedObservable.notifyObservers(light);
					},
				});
				onGizmoNodeChangedObservable.notifyObservers(light);
				return;
			}

			const node = temporaryNode;
			const sprite = temporarySprite;

			const oldValue = temporaryOldValue?.clone();
			const newValueRef = temporaryNode[property];
			const newValue = isVector3(newValueRef) ? newValueRef.clone() : null;

			registerUndoRedo({
				undo: () => {
					const valueRef = sprite?.[property] ?? node[property];

					if (sprite) {
						if (property === "position") {
							sprite.position = oldValue?.clone() ?? sprite.position;
						} else {
							sprite.width = oldValue?.x ?? sprite.width;
							sprite.height = oldValue?.y ?? sprite.height;
						}
					} else if (isVector3(valueRef) && oldValue) {
						valueRef.copyFrom(oldValue);
					} else {
						node[property] = oldValue?.clone() ?? null;
					}

					if (isLight(node)) {
						updateLightShadowMapRefreshRate(node);
						updatePointLightShadowMapRenderListPredicate(node);
						this._syncLightTransformNode();
						markVolumetricLightsDirty();
					}

					if (!sprite) {
						updateIblShadowsRenderPipeline(node.getScene());
					}

					this.setAttachedObject(sprite ?? node);
				},
				redo: () => {
					const valueRef = sprite?.[property] ?? node[property];

					if (sprite) {
						if (property === "position") {
							sprite.position = newValue?.clone() ?? sprite.position;
						} else {
							sprite.width = newValue?.x ?? sprite.width;
							sprite.height = newValue?.y ?? sprite.height;
						}
					} else if (isVector3(valueRef) && newValue) {
						valueRef.copyFrom(newValue);
					} else {
						node[property] = newValue?.clone() ?? null;
					}

					if (isLight(node)) {
						updateLightShadowMapRefreshRate(node);
						updatePointLightShadowMapRenderListPredicate(node);
						this._syncLightTransformNode();
						markVolumetricLightsDirty();
					}

					if (!sprite) {
						updateIblShadowsRenderPipeline(node.getScene());
					}

					this.setAttachedObject(sprite ?? node);
				},
			});

			if (!sprite) {
				updateIblShadowsRenderPipeline(node.getScene());
			}

			onGizmoNodeChangedObservable.notifyObservers(sprite ?? node);
		});
	}

	private _attachRotationUndoRedoEvents(gizmo: RotationGizmo): void {
		let temporaryNode: Node | null = null;
		let temporarySprite: Sprite | null = null;
		let temporaryLight: Light | null = null;

		let temporaryOldValue: Vector3 | Quaternion | null = null;

		gizmo.onDragStartObservable.add(() => {
			if (!this._attachedNode && !this._attachedLight) {
				return;
			}

			temporaryNode = this._attachedNode;
			temporarySprite = this._attachedSprite;
			temporaryLight = this._attachedLight;

			if (temporaryLight) {
				const dir = (temporaryLight as any).direction;
				temporaryOldValue = isVector3(dir) ? dir.clone() : null;
			} else if (this._attachedNode) {
				const value = this._attachedNode["rotationQuaternion"] ?? this._attachedNode["rotation"];
				temporaryOldValue = isVector3(value) || isQuaternion(value) ? value.clone() : null;
			}
		});

		gizmo.onDragObservable.add(() => {
			if (temporaryLight) {
				const dir = (temporaryLight as any).direction;
				if (isVector3(dir)) {
					dir.copyFrom(this._lightTransformNode.forward);
				}
				updateLightShadowMapRefreshRate(temporaryLight);
				updatePointLightShadowMapRenderListPredicate(temporaryLight);
				markVolumetricLightsDirty();
			} else if (isLight(temporaryNode)) {
				updateLightShadowMapRefreshRate(temporaryNode);
				updatePointLightShadowMapRenderListPredicate(temporaryNode);
			} else if (isAbstractMesh(temporaryNode)) {
				this._updateShadowMapsForMesh(temporaryNode);
			} else if (temporarySprite) {
				temporarySprite.angle = this._spriteTransformNode.rotation.z;
			}
		});

		gizmo.onDragEndObservable.add(() => {
			if (!temporaryNode && !temporaryLight) {
				return;
			}

			const node = temporaryNode;
			const sprite = temporarySprite;
			const light = temporaryLight;

			const oldValue = temporaryOldValue?.clone();

			if (light) {
				const newDirRef = (light as any).direction;
				const newDir = isVector3(newDirRef) ? newDirRef.clone() : null;

				registerUndoRedo({
					undo: () => {
						if (oldValue && isVector3(oldValue)) {
							(light as any).direction?.copyFrom(oldValue);
						}
						this._syncLightTransformNode();
						updateLightShadowMapRefreshRate(light);
						updatePointLightShadowMapRenderListPredicate(light);
						markVolumetricLightsDirty();
						this.setAttachedObject(light);
					},
					redo: () => {
						if (newDir) {
							(light as any).direction?.copyFrom(newDir);
						}
						this._syncLightTransformNode();
						updateLightShadowMapRefreshRate(light);
						updatePointLightShadowMapRenderListPredicate(light);
						markVolumetricLightsDirty();
						this.setAttachedObject(light);
					},
				});

				onGizmoNodeChangedObservable.notifyObservers(light);
				return;
			}

			const newValueRef = temporaryNode?.["rotationQuaternion"] ?? temporaryNode?.["rotation"];
			const newValue = isVector3(newValueRef) || isQuaternion(newValueRef) ? newValueRef.clone() : null;

			registerUndoRedo({
				undo: () => {
					if (!node) {
						return;
					}
					const valueRef = node["rotationQuaternion"] ?? node["rotation"];

					if (sprite) {
						sprite.angle = oldValue?.z ?? sprite.angle;
					} else if (isVector3(valueRef) && isVector3(oldValue)) {
						valueRef.copyFrom(oldValue);
					} else if (isQuaternion(valueRef) && isQuaternion(oldValue)) {
						valueRef.copyFrom(oldValue);
					}

					if (isLight(node)) {
						updateLightShadowMapRefreshRate(node);
						updatePointLightShadowMapRenderListPredicate(node);
					}

					if (!sprite) {
						updateIblShadowsRenderPipeline(node.getScene());
					}

					this.setAttachedObject(sprite ?? node);
				},
				redo: () => {
					if (!node) {
						return;
					}
					const valueRef = node["rotationQuaternion"] ?? node["rotation"];

					if (sprite) {
						sprite.angle = newValue?.z ?? sprite.angle;
					} else if (isVector3(valueRef) && isVector3(newValue)) {
						valueRef.copyFrom(newValue);
					} else if (isQuaternion(valueRef) && isQuaternion(newValue)) {
						valueRef.copyFrom(newValue);
					}

					if (isLight(node)) {
						updateLightShadowMapRefreshRate(node);
						updatePointLightShadowMapRenderListPredicate(node);
					}

					if (!sprite) {
						updateIblShadowsRenderPipeline(node.getScene());
					}

					this.setAttachedObject(sprite ?? node);
				},
			});

			if (node) {
				updateIblShadowsRenderPipeline(node.getScene());
				onGizmoNodeChangedObservable.notifyObservers(sprite ?? node);
			}
		});
	}

	private _syncLightTransformNode(): void {
		if (!this._attachedLight) {
			return;
		}

		if (isHemisphericLight(this._attachedLight)) {
			this._lightTransformNode.position.set(0, 0, 0);
		} else if ("position" in this._attachedLight && (this._attachedLight as any).position) {
			this._lightTransformNode.position.copyFrom((this._attachedLight as any).position);
		}

		if ("direction" in this._attachedLight && (this._attachedLight as any).direction) {
			this._lightTransformNode.rotationQuaternion ??= new Quaternion();
			this._lightTransformNode.setDirection((this._attachedLight as any).direction);
		}

		this._lightTransformNode.computeWorldMatrix(true);
	}

	private _getHandleMaterials(scene: Scene) {
		if (!this._handleRangeMaterial || !this._handleRangeMaterial.getScene()) {
			const m = new StandardMaterial("lightHandleRangeMat", scene);
			m.emissiveColor = new Color3(1, 0.85, 0.2);
			m.disableLighting = true;
			this._handleRangeMaterial = m;
		}
		if (!this._handleAngleMaterial || !this._handleAngleMaterial.getScene()) {
			const m = new StandardMaterial("lightHandleAngleMat", scene);
			m.emissiveColor = new Color3(1, 0.95, 0.3);
			m.disableLighting = true;
			this._handleAngleMaterial = m;
		}
		if (!this._handleSoftnessMaterial || !this._handleSoftnessMaterial.getScene()) {
			const m = new StandardMaterial("lightHandleSoftnessMat", scene);
			m.emissiveColor = new Color3(1, 0.6, 0.15);
			m.disableLighting = true;
			this._handleSoftnessMaterial = m;
		}
		if (!this._handleHoverMaterial || !this._handleHoverMaterial.getScene()) {
			const m = new StandardMaterial("lightHandleHoverMat", scene);
			m.emissiveColor = new Color3(1, 1, 1);
			m.disableLighting = true;
			this._handleHoverMaterial = m;
		}
		return {
			range: this._handleRangeMaterial,
			angle: this._handleAngleMaterial,
			softness: this._handleSoftnessMaterial,
			hover: this._handleHoverMaterial,
		};
	}

	private _setupHandleHover(mesh: Mesh, baseMat: StandardMaterial, hoverMat: StandardMaterial): void {
		mesh.actionManager = new ActionManager(this._gizmosLayer.utilityLayerScene);
		mesh.actionManager.registerAction(
			new ExecuteCodeAction(ActionManager.OnPointerOverTrigger, () => {
				mesh.material = hoverMat;
				mesh.scaling.setAll(1.35);
			})
		);
		mesh.actionManager.registerAction(
			new ExecuteCodeAction(ActionManager.OnPointerOutTrigger, () => {
				mesh.material = baseMat;
				mesh.scaling.setAll(1.0);
			})
		);
	}

	private _buildSpotLightLines(light: SpotLight, distance: number): Vector3[][] {
		const radius = distance * Math.tan(light.angle * 0.5);
		const lines: Vector3[][] = [];
		const segments = 24;

		// Base circle
		const circle: Vector3[] = [];
		for (let i = 0; i <= segments; i++) {
			const a = (i / segments) * Math.PI * 2;
			circle.push(new Vector3(radius * Math.cos(a), radius * Math.sin(a), distance));
		}
		lines.push(circle);

		// 8 rays connecting apex to base
		for (let i = 0; i < 8; i++) {
			const a = (i / 8) * Math.PI * 2;
			lines.push([Vector3.Zero(), new Vector3(radius * Math.cos(a), radius * Math.sin(a), distance)]);
		}

		// Inner angle cone (penumbra) if present
		const innerAngle = light.innerAngle && light.innerAngle > 0 && light.innerAngle < light.angle ? light.innerAngle : light.angle * 0.7;
		const innerRadius = distance * Math.tan(innerAngle * 0.5);
		const innerCircle: Vector3[] = [];
		for (let i = 0; i <= segments; i++) {
			const a = (i / segments) * Math.PI * 2;
			innerCircle.push(new Vector3(innerRadius * Math.cos(a), innerRadius * Math.sin(a), distance));
		}
		lines.push(innerCircle);

		for (let i = 0; i < 4; i++) {
			const a = (i / 4) * Math.PI * 2;
			lines.push([Vector3.Zero(), new Vector3(innerRadius * Math.cos(a), innerRadius * Math.sin(a), distance)]);
		}

		// Center axis line
		lines.push([Vector3.Zero(), new Vector3(0, 0, distance)]);

		return lines;
	}

	private _rebuildSpotLightHelperLines(light: SpotLight, distance: number): void {
		if (this._lightHelperMesh) {
			this._lightHelperMesh.dispose();
			this._lightHelperMesh = null;
		}
		const scene = this._gizmosLayer.utilityLayerScene;
		const lines = this._buildSpotLightLines(light, distance);
		this._lightHelperMesh = MeshBuilder.CreateLineSystem("spotLightConeHelper", { lines, updatable: false }, scene);
		this._lightHelperMesh.isPickable = false;
		this._lightHelperMesh.renderingGroupId = 1;
		this._lightHelperMesh.color = new Color3(1, 0.85, 0.2);
		this._lightHelperMesh.parent = this._lightTransformNode;
	}

	private _buildPointLightLines(radius: number): Vector3[][] {
		const lines: Vector3[][] = [];
		const segments = 24;

		const xy: Vector3[] = [];
		const xz: Vector3[] = [];
		const yz: Vector3[] = [];
		for (let i = 0; i <= segments; i++) {
			const a = (i / segments) * Math.PI * 2;
			xy.push(new Vector3(radius * Math.cos(a), radius * Math.sin(a), 0));
			xz.push(new Vector3(radius * Math.cos(a), 0, radius * Math.sin(a)));
			yz.push(new Vector3(0, radius * Math.cos(a), radius * Math.sin(a)));
		}
		lines.push(xy, xz, yz);
		return lines;
	}

	private _rebuildPointLightHelperLines(radius: number): void {
		if (this._lightHelperMesh) {
			this._lightHelperMesh.dispose();
			this._lightHelperMesh = null;
		}
		const scene = this._gizmosLayer.utilityLayerScene;
		const lines = this._buildPointLightLines(radius);
		this._lightHelperMesh = MeshBuilder.CreateLineSystem("pointLightHelper", { lines, updatable: false }, scene);
		this._lightHelperMesh.isPickable = false;
		this._lightHelperMesh.renderingGroupId = 1;
		this._lightHelperMesh.color = new Color3(1, 0.9, 0.3);
		this._lightHelperMesh.parent = this._lightTransformNode;
	}

	private _updateLightHelper(light: Light): void {
		this._disposeLightHelper();

		const scene = this._gizmosLayer.utilityLayerScene;
		const mats = this._getHandleMaterials(scene);

		if (isSpotLight(light)) {
			const distance = light.range > 0 && light.range < 500 ? light.range : 15;
			const radius = distance * Math.tan(light.angle * 0.5);
			const innerAngleVal = light.innerAngle && light.innerAngle > 0 && light.innerAngle < light.angle ? light.innerAngle : light.angle * 0.7;
			const innerRadius = distance * Math.tan(innerAngleVal * 0.5);

			this._rebuildSpotLightHelperLines(light, distance);

			// 1. Range Handle (Distance along cone axis)
			const rangeHandle = MeshBuilder.CreateSphere("spotRangeHandle", { diameter: 0.45, segments: 12 }, scene);
			rangeHandle.position.set(0, 0, distance);
			rangeHandle.parent = this._lightTransformNode;
			rangeHandle.material = mats.range;
			rangeHandle.renderingGroupId = 1;
			this._setupHandleHover(rangeHandle, mats.range, mats.hover);

			const rangeDrag = new PointerDragBehavior();
			rangeDrag.moveAttached = false;
			let initialDistance = distance;
			rangeDrag.onDragStartObservable.add(() => {
				this._isDraggingLightHandle = true;
				initialDistance = light.range > 0 && light.range < 500 ? light.range : 15;
			});
			rangeDrag.onDragObservable.add((event) => {
				const dir = light.direction.normalizeToNew();
				const deltaZ = Vector3.Dot(event.delta, dir);
				const currentDist = light.range > 0 && light.range < 500 ? light.range : 15;
				const newDist = Math.max(0.5, Math.min(500, currentDist + deltaZ));
				light.range = newDist;

				rangeHandle.position.set(0, 0, newDist);
				const r = newDist * Math.tan(light.angle * 0.5);
				angleHandle.position.set(r, 0, newDist);
				const ir = newDist * Math.tan((light.innerAngle || light.angle * 0.7) * 0.5);
				softnessHandle.position.set(ir, 0, newDist);

				this._rebuildSpotLightHelperLines(light, newDist);
				updateLightShadowMapRefreshRate(light);
				updatePointLightShadowMapRenderListPredicate(light);
				markVolumetricLightsDirty();
				onGizmoNodeChangedObservable.notifyObservers(light);
			});
			rangeDrag.onDragEndObservable.add(() => {
				this._isDraggingLightHandle = false;
				const oldR = initialDistance;
				const newR = light.range;
				registerUndoRedo({
					undo: () => {
						light.range = oldR;
						this._updateLightHelper(light);
						onGizmoNodeChangedObservable.notifyObservers(light);
					},
					redo: () => {
						light.range = newR;
						this._updateLightHelper(light);
						onGizmoNodeChangedObservable.notifyObservers(light);
					},
				});
				onGizmoNodeChangedObservable.notifyObservers(light);
			});
			rangeHandle.addBehavior(rangeDrag);
			this._lightHandleMeshes.push(rangeHandle);

			// 2. Angle Handle (Outer cone angle)
			const angleHandle = MeshBuilder.CreateSphere("spotAngleHandle", { diameter: 0.4, segments: 12 }, scene);
			angleHandle.position.set(radius, 0, distance);
			angleHandle.parent = this._lightTransformNode;
			angleHandle.material = mats.angle;
			angleHandle.renderingGroupId = 1;
			this._setupHandleHover(angleHandle, mats.angle, mats.hover);

			const angleDrag = new PointerDragBehavior();
			angleDrag.moveAttached = false;
			let initialAngle = light.angle;
			let initialInnerAngle = light.innerAngle;
			angleDrag.onDragStartObservable.add(() => {
				this._isDraggingLightHandle = true;
				initialAngle = light.angle;
				initialInnerAngle = light.innerAngle;
			});
			angleDrag.onDragObservable.add((event) => {
				const currentDist = light.range > 0 && light.range < 500 ? light.range : 15;
				const worldBaseCenter = Vector3.TransformCoordinates(new Vector3(0, 0, currentDist), this._lightTransformNode.getWorldMatrix());
				const radialDir = angleHandle.getAbsolutePosition().subtract(worldBaseCenter).normalize();
				const deltaR = Vector3.Dot(event.delta, radialDir);
				const currentR = currentDist * Math.tan(light.angle * 0.5);
				const newRadius = Math.max(0.05, currentR + deltaR);
				const newAngle = Math.min(Math.PI * 0.95, Math.max(0.05, 2 * Math.atan(newRadius / currentDist)));
				light.angle = newAngle;
				if (light.innerAngle && light.innerAngle >= light.angle) {
					light.innerAngle = light.angle * 0.8;
				}

				angleHandle.position.set(newRadius, 0, currentDist);
				const ir = currentDist * Math.tan((light.innerAngle || newAngle * 0.7) * 0.5);
				softnessHandle.position.set(ir, 0, currentDist);

				this._rebuildSpotLightHelperLines(light, currentDist);
				updateLightShadowMapRefreshRate(light);
				markVolumetricLightsDirty();
				onGizmoNodeChangedObservable.notifyObservers(light);
			});
			angleDrag.onDragEndObservable.add(() => {
				this._isDraggingLightHandle = false;
				const oldA = initialAngle;
				const oldInner = initialInnerAngle;
				const newA = light.angle;
				const newInner = light.innerAngle;
				registerUndoRedo({
					undo: () => {
						light.angle = oldA;
						light.innerAngle = oldInner;
						this._updateLightHelper(light);
						onGizmoNodeChangedObservable.notifyObservers(light);
					},
					redo: () => {
						light.angle = newA;
						light.innerAngle = newInner;
						this._updateLightHelper(light);
						onGizmoNodeChangedObservable.notifyObservers(light);
					},
				});
				onGizmoNodeChangedObservable.notifyObservers(light);
			});
			angleHandle.addBehavior(angleDrag);
			this._lightHandleMeshes.push(angleHandle);

			// 3. Softness / Penumbra Handle
			const softnessHandle = MeshBuilder.CreateSphere("spotSoftnessHandle", { diameter: 0.35, segments: 12 }, scene);
			softnessHandle.position.set(innerRadius, 0, distance);
			softnessHandle.parent = this._lightTransformNode;
			softnessHandle.material = mats.softness;
			softnessHandle.renderingGroupId = 1;
			this._setupHandleHover(softnessHandle, mats.softness, mats.hover);

			const softnessDrag = new PointerDragBehavior();
			softnessDrag.moveAttached = false;
			let initialSoftnessInner = light.innerAngle;
			softnessDrag.onDragStartObservable.add(() => {
				this._isDraggingLightHandle = true;
				initialSoftnessInner = light.innerAngle;
			});
			softnessDrag.onDragObservable.add((event) => {
				const currentDist = light.range > 0 && light.range < 500 ? light.range : 15;
				const worldBaseCenter = Vector3.TransformCoordinates(new Vector3(0, 0, currentDist), this._lightTransformNode.getWorldMatrix());
				const radialDir = softnessHandle.getAbsolutePosition().subtract(worldBaseCenter).normalize();
				const deltaR = Vector3.Dot(event.delta, radialDir);
				const currentInnerR = currentDist * Math.tan((light.innerAngle || light.angle * 0.7) * 0.5);
				const newInnerR = Math.max(0.01, currentInnerR + deltaR);
				const newInnerAngle = Math.min(light.angle * 0.98, Math.max(0.01, 2 * Math.atan(newInnerR / currentDist)));
				light.innerAngle = newInnerAngle;

				softnessHandle.position.set(newInnerR, 0, currentDist);
				this._rebuildSpotLightHelperLines(light, currentDist);
				updateLightShadowMapRefreshRate(light);
				markVolumetricLightsDirty();
				onGizmoNodeChangedObservable.notifyObservers(light);
			});
			softnessDrag.onDragEndObservable.add(() => {
				this._isDraggingLightHandle = false;
				const oldInner = initialSoftnessInner;
				const newInner = light.innerAngle;
				registerUndoRedo({
					undo: () => {
						light.innerAngle = oldInner;
						this._updateLightHelper(light);
						onGizmoNodeChangedObservable.notifyObservers(light);
					},
					redo: () => {
						light.innerAngle = newInner;
						this._updateLightHelper(light);
						onGizmoNodeChangedObservable.notifyObservers(light);
					},
				});
				onGizmoNodeChangedObservable.notifyObservers(light);
			});
			softnessHandle.addBehavior(softnessDrag);
			this._lightHandleMeshes.push(softnessHandle);

		} else if (isPointLight(light)) {
			const radius = light.range > 0 && light.range < 500 ? light.range : 5;
			this._rebuildPointLightHelperLines(radius);

			// Point Range Handle
			const pointHandle = MeshBuilder.CreateSphere("pointRangeHandle", { diameter: 0.45, segments: 12 }, scene);
			pointHandle.position.set(radius, 0, 0);
			pointHandle.parent = this._lightTransformNode;
			pointHandle.material = mats.range;
			pointHandle.renderingGroupId = 1;
			this._setupHandleHover(pointHandle, mats.range, mats.hover);

			const pDrag = new PointerDragBehavior();
			pDrag.moveAttached = false;
			let initialPRange = light.range;
			pDrag.onDragStartObservable.add(() => {
				this._isDraggingLightHandle = true;
				initialPRange = light.range > 0 && light.range < 500 ? light.range : 5;
			});
			pDrag.onDragObservable.add((event) => {
				const radialDir = pointHandle.getAbsolutePosition().subtract(light.getAbsolutePosition()).normalize();
				const deltaR = Vector3.Dot(event.delta, radialDir);
				const curR = light.range > 0 && light.range < 500 ? light.range : 5;
				const newRange = Math.max(0.5, Math.min(500, curR + deltaR));
				light.range = newRange;

				pointHandle.position.set(newRange, 0, 0);
				this._rebuildPointLightHelperLines(newRange);
				updateLightShadowMapRefreshRate(light);
				updatePointLightShadowMapRenderListPredicate(light);
				markVolumetricLightsDirty();
				onGizmoNodeChangedObservable.notifyObservers(light);
			});
			pDrag.onDragEndObservable.add(() => {
				this._isDraggingLightHandle = false;
				const oldR = initialPRange;
				const newR = light.range;
				registerUndoRedo({
					undo: () => {
						light.range = oldR;
						this._updateLightHelper(light);
						onGizmoNodeChangedObservable.notifyObservers(light);
					},
					redo: () => {
						light.range = newR;
						this._updateLightHelper(light);
						onGizmoNodeChangedObservable.notifyObservers(light);
					},
				});
				onGizmoNodeChangedObservable.notifyObservers(light);
			});
			pointHandle.addBehavior(pDrag);
			this._lightHandleMeshes.push(pointHandle);

		} else if (isDirectionalLight(light)) {
			const length = 10;
			const lines: Vector3[][] = [];

			// Center line with arrow
			lines.push([new Vector3(0, 0, -length * 0.5), new Vector3(0, 0, length * 0.5)]);
			lines.push([new Vector3(0, 0, length * 0.5), new Vector3(length * 0.1, 0, length * 0.35)]);
			lines.push([new Vector3(0, 0, length * 0.5), new Vector3(-length * 0.1, 0, length * 0.35)]);
			lines.push([new Vector3(0, 0, length * 0.5), new Vector3(0, length * 0.1, length * 0.35)]);
			lines.push([new Vector3(0, 0, length * 0.5), new Vector3(0, -length * 0.1, length * 0.35)]);

			const offset = 2;
			const offsets = [
				[-offset, -offset],
				[offset, -offset],
				[-offset, offset],
				[offset, offset],
			];
			offsets.forEach(([ox, oy]) => {
				lines.push([new Vector3(ox, oy, -length * 0.3), new Vector3(ox, oy, length * 0.3)]);
				lines.push([new Vector3(ox, oy, length * 0.3), new Vector3(ox + length * 0.05, oy, length * 0.2)]);
			});

			this._lightHelperMesh = MeshBuilder.CreateLineSystem("dirLightHelper", { lines, updatable: false }, scene);
			this._lightHelperMesh.isPickable = false;
			this._lightHelperMesh.renderingGroupId = 1;
			this._lightHelperMesh.color = new Color3(1, 0.95, 0.4);
			this._lightHelperMesh.parent = this._lightTransformNode;
		}

		this._syncLightTransformNode();
	}

	private _disposeLightHelper(): void {
		if (this._lightHelperMesh) {
			this._lightHelperMesh.dispose();
			this._lightHelperMesh = null;
		}

		this._lightHandleMeshes.forEach((mesh) => {
			mesh.dispose();
		});
		this._lightHandleMeshes = [];
	}
}
