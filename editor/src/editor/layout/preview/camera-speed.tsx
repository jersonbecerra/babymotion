import { useEffect, useState } from "react";
import { IoSpeedometerOutline } from "react-icons/io5";
import { FaPersonWalking, FaBicycle, FaCarSide, FaPlane, FaPlus, FaMinus } from "react-icons/fa6";
import { LuRocket, LuGauge } from "react-icons/lu";

import { cn } from "../../../ui/utils";
import { Button } from "../../../ui/shadcn/ui/button";
import { Slider } from "../../../ui/shadcn/ui/slider";
import { Badge } from "../../../ui/shadcn/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "../../../ui/shadcn/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "../../../ui/shadcn/ui/tooltip";
import { Separator } from "../../../ui/shadcn/ui/separator";

import { Editor } from "../../main";
import { EditorCamera } from "../../nodes/camera";
import type { EditorPreview } from "../preview";

export interface IEditorPreviewCameraSpeedProps {
	editor: Editor;
	preview?: EditorPreview;
	camera?: EditorCamera;
}

export interface ICameraSpeedPreset {
	level: number;
	name: string;
	speed: number;
	icon: any;
	description: string;
}

export const CAMERA_SPEED_PRESETS: ICameraSpeedPreset[] = [
	{ level: 1, name: "Detalle", speed: 15, icon: FaPersonWalking, description: "15 — Detalle fino y precisión cercana" },
	{ level: 2, name: "Peatón", speed: 40, icon: FaPersonWalking, description: "40 — Paso humano e interiores de habitaciones" },
	{ level: 3, name: "Bicicleta", speed: 100, icon: FaBicycle, description: "100 — Velocidad estándar cómoda (con Shift 5X = 500)" },
	{ level: 4, name: "Vehículo", speed: 300, icon: FaCarSide, description: "300 — Calles, exteriores y arquitectura media" },
	{ level: 5, name: "Avión", speed: 1000, icon: FaPlane, description: "1,000 — Sobrevuelo y escenarios grandes" },
	{ level: 6, name: "Hipersónico", speed: 3000, icon: LuRocket, description: "3,000 — Paisajes masivos y terrenos gigantes" },
];

/**
 * Maps a speed value (1 .. 5000) to a logarithmic slider position (0 .. 100).
 */
function speedToSlider(speed: number): number {
	const clamped = Math.max(1, Math.min(5000, speed));
	return (Math.log(clamped / 1) / Math.log(5000)) * 100;
}

/**
 * Maps a logarithmic slider position (0 .. 100) back to a speed value (1 .. 5000).
 */
function sliderToSpeed(val: number): number {
	const clamped = Math.max(0, Math.min(100, val));
	const raw = Math.pow(5000, clamped / 100);
	if (raw < 50) {
		return Math.round(raw);
	}
	if (raw < 500) {
		return Math.round(raw / 5) * 5;
	}
	if (raw < 2000) {
		return Math.round(raw / 25) * 25;
	}
	return Math.round(raw / 100) * 100;
}

export function EditorPreviewCameraSpeed(props: IEditorPreviewCameraSpeedProps) {
	const getCamera = (): EditorCamera | undefined => {
		return (
			props.camera ??
			(props.preview?.camera as EditorCamera | undefined) ??
			(props.editor?.layout?.preview?.camera as EditorCamera | undefined)
		);
	};

	const camera = getCamera();
	const [speed, setSpeedState] = useState<number>(() => {
		try {
			const saved = localStorage.getItem("editor-camera-speed");
			if (saved) {
				const val = parseFloat(saved);
				if (!isNaN(val) && val > 0) {
					return val;
				}
			}
		} catch {}
		return camera?.baseSpeed ?? 100;
	});

	const [boostMultiplier, setBoostMultiplierState] = useState<number>(() => {
		try {
			const saved = localStorage.getItem("editor-camera-boost");
			if (saved) {
				const val = parseFloat(saved);
				if (!isNaN(val) && val >= 1) {
					return val;
				}
			}
		} catch {}
		return camera?.boostMultiplier ?? 5.0;
	});

	const [isShiftActive, setIsShiftActive] = useState<boolean>(() => camera?.isShiftPressed ?? false);
	const [isOpen, setIsOpen] = useState<boolean>(false);

	useEffect(() => {
		const cam = getCamera();
		if (!cam) {
			return;
		}

		setSpeedState(cam.baseSpeed);
		setBoostMultiplierState(cam.boostMultiplier);
		setIsShiftActive(cam.isShiftPressed);

		const observer = cam.onSpeedChangedObservable?.add(() => {
			setSpeedState(cam.baseSpeed);
			setBoostMultiplierState(cam.boostMultiplier);
			setIsShiftActive(cam.isShiftPressed);
		});

		return () => {
			if (observer && cam.onSpeedChangedObservable) {
				cam.onSpeedChangedObservable.remove(observer);
			}
		};
	}, [props.camera, props.preview?.camera, props.editor?.layout?.preview?.camera]);

	const updateSpeed = (newSpeed: number) => {
		const cam = getCamera();
		if (cam) {
			cam.baseSpeed = newSpeed;
			setSpeedState(cam.baseSpeed);
		} else {
			setSpeedState(newSpeed);
			try {
				localStorage.setItem("editor-camera-speed", newSpeed.toString());
			} catch {}
		}
	};

	const updateBoost = (multiplier: number) => {
		const cam = getCamera();
		if (cam) {
			cam.boostMultiplier = multiplier;
			setBoostMultiplierState(cam.boostMultiplier);
		} else {
			setBoostMultiplierState(multiplier);
			try {
				localStorage.setItem("editor-camera-boost", multiplier.toString());
			} catch {}
		}
	};

	// Determine matching preset if any
	const activePreset = CAMERA_SPEED_PRESETS.find((p) => Math.abs(speed - p.speed) / p.speed < 0.15);

	const formatSpeedLabel = () => {
		const activeSpeed = isShiftActive ? Math.round(speed * boostMultiplier) : Math.round(speed);
		if (activeSpeed >= 1000) {
			const k = activeSpeed / 1000;
			return k % 1 === 0 ? `${k}k` : `${k.toFixed(1)}k`;
		}
		return `${activeSpeed}`;
	};

	return (
		<Popover open={isOpen} onOpenChange={setIsOpen}>
			<Tooltip>
				<TooltipTrigger asChild>
					<PopoverTrigger asChild>
						<Button
							variant="ghost"
							className={cn(
								"px-2 py-1 h-9 flex items-center gap-1.5 transition-colors border border-transparent hover:border-border/60",
								isShiftActive && "bg-primary/25 text-primary border-primary/50 shadow-sm",
								isOpen && "bg-muted"
							)}
						>
							<IoSpeedometerOutline className="w-4 h-4 text-primary" />
							<span className="text-xs font-semibold tabular-nums tracking-tight">
								{formatSpeedLabel()}
							</span>
							{isShiftActive && (
								<span className="text-[10px] font-bold text-amber-500 uppercase">⚡</span>
							)}
						</Button>
					</PopoverTrigger>
				</TooltipTrigger>
				<TooltipContent side="bottom">
					Velocidad de Navegación de Cámara
				</TooltipContent>
			</Tooltip>

			<PopoverContent
				className="w-84 p-3.5 shadow-2xl border bg-popover/95 backdrop-blur-md flex flex-col gap-3"
				align="end"
				side="bottom"
				sideOffset={6}
			>
				{/* Header */}
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-2">
						<LuGauge className="w-4 h-4 text-primary" />
						<span className="font-semibold text-sm">Velocidad de Navegación</span>
					</div>
					<Badge variant="outline" className="text-[10px] font-mono uppercase bg-primary/10 text-primary border-primary/25">
						Nivel {activePreset ? activePreset.level : "Custom"}
					</Badge>
				</div>

				<Separator />

				{/* Speed Presets (1 - 6) */}
				<div className="flex flex-col gap-1.5">
					<div className="flex items-center justify-between text-xs text-muted-foreground">
						<span>Nivel de desplazamiento</span>
						<span className="text-xs font-mono text-primary font-semibold">
							{activePreset ? `${activePreset.name} (${Math.round(speed)})` : `${Math.round(speed)}`}
						</span>
					</div>
					<div className="grid grid-cols-6 gap-1">
						{CAMERA_SPEED_PRESETS.map((preset) => {
							const Icon = preset.icon;
							const isSelected = activePreset?.level === preset.level;

							return (
								<Tooltip key={preset.level}>
									<TooltipTrigger asChild>
										<Button
											variant={isSelected ? "default" : "outline"}
											size="sm"
											className={cn(
												"h-11 flex flex-col items-center justify-center p-0.5 gap-0.5 transition-all",
												isSelected && "ring-2 ring-primary ring-offset-1 bg-primary text-primary-foreground font-bold shadow"
											)}
											onClick={() => updateSpeed(preset.speed)}
										>
											<span className="text-[11px] font-bold leading-none">{preset.level}</span>
											<Icon className="w-3.5 h-3.5 opacity-80" />
										</Button>
									</TooltipTrigger>
									<TooltipContent side="top" className="text-xs">
										<p className="font-semibold">{preset.name} (Nivel {preset.level})</p>
										<p className="text-muted-foreground">{preset.description}</p>
									</TooltipContent>
								</Tooltip>
							);
						})}
					</div>
				</div>

				{/* Slider Fine Adjustment */}
				<div className="flex flex-col gap-2 pt-1">
					<div className="flex items-center justify-between text-xs">
						<span className="text-muted-foreground">Ajuste fino</span>
						<div className="flex items-center gap-1.5">
							<Button
								variant="outline"
								size="icon"
								className="w-5 h-5 rounded-full p-0"
								onClick={() => updateSpeed(Math.max(1, Math.round(speed * 0.8)))}
							>
								<FaMinus className="w-2.5 h-2.5" />
							</Button>
							<span className="font-mono text-xs font-semibold tabular-nums px-1.5 min-w-[42px] text-center bg-muted/60 rounded py-0.5">
								{Math.round(speed)}
							</span>
							<Button
								variant="outline"
								size="icon"
								className="w-5 h-5 rounded-full p-0"
								onClick={() => updateSpeed(Math.min(5000, Math.round(speed * 1.25)))}
							>
								<FaPlus className="w-2.5 h-2.5" />
							</Button>
						</div>
					</div>
					<Slider
						value={[speedToSlider(speed)]}
						min={0}
						max={100}
						step={1}
						onValueChange={([val]) => updateSpeed(sliderToSpeed(val))}
						className="w-full cursor-pointer py-1"
					/>
				</div>

				<Separator />

				{/* Turbo / Boost Multiplier with Shift */}
				<div className="flex items-center justify-between text-xs">
					<div className="flex flex-col">
						<span className="font-medium text-xs">Turbo con Shift</span>
						<span className="text-[10px] text-muted-foreground">Velocidad con Shift: {Math.round(speed * boostMultiplier)}</span>
					</div>
					<div className="flex items-center gap-1">
						{[2, 3, 5, 10].map((multiplier) => (
							<Button
								key={multiplier}
								variant={boostMultiplier === multiplier ? "default" : "outline"}
								size="sm"
								className={cn(
									"h-6 px-2 text-xs font-semibold",
									boostMultiplier === multiplier && "bg-primary text-primary-foreground"
								)}
								onClick={() => updateBoost(multiplier)}
							>
								{multiplier}x
							</Button>
						))}
					</div>
				</div>

				{/* Shortcuts Footer Tips */}
				<div className="bg-muted/40 rounded-md p-2 text-[10px] text-muted-foreground flex flex-col gap-1 border border-border/40">
					<div className="flex items-center gap-1 font-medium text-foreground/85">
						<span>💡 Atajos rápidos:</span>
					</div>
					<div>• Teclas <kbd className="px-1 py-0.5 bg-muted rounded font-mono text-[9px] border">1</kbd> a <kbd className="px-1 py-0.5 bg-muted rounded font-mono text-[9px] border">6</kbd>: Cambiar nivel en el visor</div>
					<div>• Mantener <kbd className="px-1 py-0.5 bg-muted rounded font-mono text-[9px] border">Shift</kbd> + <kbd className="px-1 py-0.5 bg-muted rounded font-mono text-[9px] border">WASD</kbd>: Turbo ({boostMultiplier}X = {Math.round(speed * boostMultiplier)})</div>
					<div>• <kbd className="px-1 py-0.5 bg-muted rounded font-mono text-[9px] border">Clic Der.</kbd> + <kbd className="px-1 py-0.5 bg-muted rounded font-mono text-[9px] border">Rueda</kbd>: Ajustar velocidad al vuelo</div>
				</div>
			</PopoverContent>
		</Popover>
	);
}
