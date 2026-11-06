import { Light, Scene, Vector3 } from "babylonjs";

import { isGaussianSplattingMesh, isPointLight, isSpotLight } from "../guards/nodes";

/**
 * Updates the shadow map render list predicate of the given point light.
 * Will basically filter out meshes that are too far from the light according to
 * the current light's `range` value.
 * @param light defines the reference to the point light to configure.
 */
export function updatePointLightShadowMapRenderListPredicate(light: Light): void {
	if (!isPointLight(light) && !isSpotLight(light)) {
		return;
	}

	const shadowMap = light.getShadowGenerator()?.getShadowMap();
	if (!shadowMap) {
		return;
	}

	shadowMap.renderListPredicate = (mesh) => {
		if (isGaussianSplattingMesh(mesh)) {
			return false;
		}

		if (light.range <= 0) {
			return true;
		}

		const distance = Vector3.Distance(mesh.getAbsolutePosition(), light.getAbsolutePosition());
		return distance <= light.range;
	};
}

/**
 * In case the light has a refresh rate of 0, let's update them to reset refresh rate to
 * 0 in order to re-trigger a render of the shadow map. This is typically used when a light is moved in the editor.
 * @param light defines the reference to the light to configure.
 */
export function updateLightShadowMapRefreshRate(light: Light): void {
	const shadowMap = light.getShadowGenerator()?.getShadowMap();
	if (!shadowMap) {
		return;
	}

	shadowMap.resetRefreshCounter();
}

/**
 * Updates all the lights properties (shadow maps, list predicates etc.).
 * @param scene defines the reference to the scene that contains all lights to update.
 */
export function updateAllLights(scene: Scene) {
	const meshes = scene.meshes.filter((m) => !isGaussianSplattingMesh(m));

	scene.lights.forEach((light) => {
		const generator = light.getShadowGenerator();
		if (generator) {
			const shadowMap = generator.getShadowMap();
			if (shadowMap) {
				if (!shadowMap.renderList || shadowMap.renderList.length === 0) {
					shadowMap.renderList = meshes.slice(0);
				} else {
					meshes.forEach((m) => {
						if (!shadowMap.renderList!.includes(m)) {
							shadowMap.renderList!.push(m);
						}
					});
				}

				if (scene.activeCamera) {
					shadowMap.activeCamera = scene.activeCamera;
				}
				shadowMap.resetRefreshCounter();
			}
		}

		updateLightShadowMapRefreshRate(light);
		updatePointLightShadowMapRenderListPredicate(light);
	});
}
