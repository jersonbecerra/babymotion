import { DirectionalLight, HemisphericLight, Material, Node, PointLight, SpotLight, Tools, Vector3, Light, ShadowGenerator } from "babylonjs";
import { ensureVolumetricLightConfiguration } from "babylonjs-editor-tools";

import { UniqueNumber } from "../../tools/tools";
import { isClusteredLightContainer, isGaussianSplattingMesh } from "../../tools/guards/nodes";
import { configureSimultaneousLightsForMaterial } from "../../tools/material/material";
import { getVolumetricLightingRenderingPipeline } from "../../editor/rendering/volumetric-lighting";
import { updateLightShadowMapRefreshRate, updatePointLightShadowMapRenderListPredicate } from "../../tools/light/shadows";

import { Editor } from "../../editor/main";

function getSpawnTransform(editor: Editor) {
	const camera = editor.layout.preview.camera;
	const target = camera.getTarget ? camera.getTarget() : Vector3.Zero();
	const camPos = camera.position;
	const distance = Math.min(Math.max(Vector3.Distance(camPos, target), 3), 30);
	return { target, camPos, distance };
}

function refreshSceneMaterialsForNewLight(editor: Editor) {
	const scene = editor.layout.preview.scene;
	scene.materials.forEach((m) => configureSimultaneousLightsForMaterial(m));
	scene.markAllMaterialsAsDirty(Material.LightDirtyFlag);
}

function setupDefaultShadows(editor: Editor, light: PointLight | SpotLight | DirectionalLight) {
	try {
		const isDir = light instanceof DirectionalLight;
		const isSpot = light instanceof SpotLight;
		const mapSize = isDir ? 2048 : 1024;
		const shadowGenerator = new ShadowGenerator(mapSize, light, true);

		if (isSpot || isDir) {
			shadowGenerator.usePercentageCloserFiltering = true;
			shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_HIGH;
		}

		shadowGenerator.transparencyShadow = true;
		shadowGenerator.enableSoftTransparentShadow = true;

		const shadowMap = shadowGenerator.getShadowMap();
		if (shadowMap) {
			const meshes = editor.layout.preview.scene.meshes.filter((m) => !isGaussianSplattingMesh(m));
			shadowMap.renderList?.push(...meshes);
		}

		updateLightShadowMapRefreshRate(light);
		updatePointLightShadowMapRenderListPredicate(light);
	} catch (e) {
		console.warn("Could not create default shadow generator for light:", e);
	}
}

export function addPointLight(editor: Editor, parent?: Node) {
	const { target, distance } = getSpawnTransform(editor);
	const spawnPos = target.add(new Vector3(0, Math.min(distance * 0.35, 4), 0));

	const light = new PointLight("New Point Light", spawnPos, editor.layout.preview.scene);
	light.id = Tools.RandomId();
	light.uniqueId = UniqueNumber.Get();
	light.intensity = 15;
	light.range = 25;
	light.radius = 0.3;
	light.falloffType = Light.FALLOFF_PHYSICAL;

	if (getVolumetricLightingRenderingPipeline()) {
		ensureVolumetricLightConfiguration(light as any).enabled = true;
	}

	if (parent && isClusteredLightContainer(parent)) {
		parent.addLight(light);
	} else {
		light.parent = parent ?? null;
		setupDefaultShadows(editor, light);
	}

	refreshSceneMaterialsForNewLight(editor);

	editor.layout.graph.refresh().then(() => {
		editor.layout.graph.setSelectedNode(light);
	});

	editor.layout.inspector.setEditedObject(light);
	editor.layout.preview.gizmo.setAttachedObject(light);

	if (editor.layout.preview.state.activeGizmo === "none") {
		editor.layout.preview.setActiveGizmo("position");
	}

	return light;
}

export function addDirectionalLight(editor: Editor, parent?: Node) {
	const { target } = getSpawnTransform(editor);
	const light = new DirectionalLight("New Directional Light", new Vector3(-0.5, -1, -0.5).normalize(), editor.layout.preview.scene);
	light.position.copyFrom(target.add(new Vector3(0, 10, 0)));
	light.id = Tools.RandomId();
	light.uniqueId = UniqueNumber.Get();
	light.intensity = 2;
	light.parent = parent ?? null;

	if (getVolumetricLightingRenderingPipeline()) {
		ensureVolumetricLightConfiguration(light as any).enabled = true;
	}

	setupDefaultShadows(editor, light);
	refreshSceneMaterialsForNewLight(editor);

	editor.layout.graph.refresh().then(() => {
		editor.layout.graph.setSelectedNode(light);
	});

	editor.layout.inspector.setEditedObject(light);
	editor.layout.preview.gizmo.setAttachedObject(light);

	if (editor.layout.preview.state.activeGizmo === "none") {
		editor.layout.preview.setActiveGizmo("position");
	}

	return light;
}

export function addSpotLight(editor: Editor, parent?: Node) {
	const { target, distance } = getSpawnTransform(editor);
	const camera = editor.layout.preview.camera;
	const spawnPos = target.add(new Vector3(0, Math.min(distance * 0.5, 6), 0)).subtract(camera.getForwardRay().direction.scale(Math.min(distance * 0.3, 4)));
	const dir = target.subtract(spawnPos).normalize();

	const angle = Math.PI / 3;
	const light = new SpotLight("New Spot Light", spawnPos, dir, angle, 2, editor.layout.preview.scene);
	light.id = Tools.RandomId();
	light.uniqueId = UniqueNumber.Get();
	light.intensity = 20;
	light.range = 30;
	light.innerAngle = angle * 0.7; // Smooth realistic 30% penumbra falloff
	light.falloffType = Light.FALLOFF_PHYSICAL;
	light.radius = 0.2;

	if (getVolumetricLightingRenderingPipeline()) {
		ensureVolumetricLightConfiguration(light as any).enabled = true;
	}

	if (parent && isClusteredLightContainer(parent)) {
		parent.addLight(light);
	} else {
		light.parent = parent ?? null;
		setupDefaultShadows(editor, light);
	}

	refreshSceneMaterialsForNewLight(editor);

	editor.layout.graph.refresh().then(() => {
		editor.layout.graph.setSelectedNode(light);
	});

	editor.layout.inspector.setEditedObject(light);
	editor.layout.preview.gizmo.setAttachedObject(light);

	if (editor.layout.preview.state.activeGizmo === "none") {
		editor.layout.preview.setActiveGizmo("position");
	}

	return light;
}

export function addHemisphericLight(editor: Editor, parent?: Node) {
	const light = new HemisphericLight("New Hemispheric Light", new Vector3(0, 1, 0), editor.layout.preview.scene);
	light.id = Tools.RandomId();
	light.uniqueId = UniqueNumber.Get();
	light.parent = parent ?? null;

	refreshSceneMaterialsForNewLight(editor);

	editor.layout.graph.refresh().then(() => {
		editor.layout.graph.setSelectedNode(light);
	});

	editor.layout.inspector.setEditedObject(light);
	editor.layout.preview.gizmo.setAttachedObject(light);

	return light;
}
