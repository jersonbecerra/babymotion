import { Material, MultiMaterial, NodeMaterial, Scene } from "babylonjs";

import { isInstancedMesh } from "../guards/nodes";
import { isNodeMaterial, isPBRMaterial, isStandardMaterial } from "../guards/material";

/**
 * Configures the given material to receive up to 4 lights simultaneously.
 * In WebGL 2, GL_MAX_VERTEX_UNIFORM_BUFFERS is commonly 12. Setting this higher (e.g. 16 or 32)
 * causes shader compilation failures ("VERTEX shader uniform block count exceeds GL_MAX_VERTEX_UNIFORM_BUFFERS (12)")
 * whenever multiple lights, shadows, and post-process pipelines (TAA, pre-pass, motion blur) are present.
 * Babylon.js standard is 4, which dynamically assigns the 4 closest/most relevant lights per mesh.
 * @param material defines the reference to the material to configure.
 */
export function configureSimultaneousLightsForMaterial(material: Material) {
	if (material instanceof MultiMaterial || (material as any).subMaterials) {
		(material as any).subMaterials?.forEach((sub: Material) => {
			if (sub) {
				configureSimultaneousLightsForMaterial(sub);
			}
		});
		return;
	}

	if (isPBRMaterial(material) || isStandardMaterial(material) || isNodeMaterial(material)) {
		material.maxSimultaneousLights = 4;
	}
}

/**
 * Force compile all materials of the given scene.
 * This is useful to ensure that all materials are compiled and ready to use to avoid lag in the editor.
 * @param scene The scene to force compile all materials
 */
export function forceCompileAllSceneMaterials(scene: Scene) {
	scene.materials.forEach((material) => configureSimultaneousLightsForMaterial(material));

	return Promise.all(
		scene.materials.map(async (material) => {
			const meshes = material.getBindedMeshes();

			await Promise.all(
				meshes.map(async (mesh) => {
					if (isInstancedMesh(mesh)) {
						return;
					}

					try {
						await material.forceCompilationAsync(mesh, {
							clipPlane: !!scene.clipPlane,
							useInstances: mesh.hasInstances,
						});
					} catch (e) {
						console.error(`Failed to force compile material ${material.name} for mesh ${mesh.name}:`, e);
					}
				})
			);
		})
	);
}

/**
 * Normalizes the unique IDs of the nodes in the given Node Material based on the provided material data.
 * This allows to get ids not modified after reloading the material to be git-compliant.
 */
export function normalizeNodeMaterialUniqueIds(material: NodeMaterial, materialData: any) {
	material.editorData = materialData.editorData;
	material.attachedBlocks.forEach((block, index) => {
		const oldUniqueId = block.uniqueId;
		const newUniqueId = materialData.blocks[index].id;

		material.editorData?.locations?.forEach((location) => {
			if (location.blockId === oldUniqueId) {
				location.blockId = newUniqueId;
			}
		});

		for (const key in material.editorData?.map ?? {}) {
			if (!material.editorData?.map.hasOwnProperty(key)) {
				continue;
			}

			const value = material.editorData.map[key];
			if (value === oldUniqueId) {
				material.editorData.map[key] = newUniqueId;
			}
		}

		block.uniqueId = newUniqueId;
	});
}
