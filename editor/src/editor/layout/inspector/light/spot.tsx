import { Component, ReactNode } from "react";
import { Divider } from "@blueprintjs/core";

import { Light, SpotLight } from "babylonjs";

import { isSpotLight } from "../../../../tools/guards/nodes";
import { onNodeModifiedObservable } from "../../../../tools/observables";
import { updateLightShadowMapRefreshRate, updatePointLightShadowMapRenderListPredicate } from "../../../../tools/light/shadows";

import { IEditorInspectorImplementationProps } from "../inspector";

import { EditorInspectorColorField } from "../fields/color";
import { EditorInspectorStringField } from "../fields/string";
import { EditorInspectorVectorField } from "../fields/vector";
import { EditorInspectorNumberField } from "../fields/number";
import { EditorInspectorSectionField } from "../fields/section";
import { EditorInspectorListField } from "../fields/list";
// import { EditorInspectorTextureField } from "../fields/texture";

import { ScriptInspectorComponent } from "../script/script";
import { CustomMetadataInspector } from "../metadata/custom-metadata";

import { EditorLightPBRInspector } from "./components/pbr";
import { EditorLightClusterInspector } from "./components/cluster";
import { EditorLightShadowsInspector } from "./components/shadows";
import { EditorLightVolumetricInspector } from "./components/volumetric";

export class EditorSpotLightInspector extends Component<IEditorInspectorImplementationProps<SpotLight>> {
	/**
	 * Returns whether or not the given object is supported by this inspector.
	 * @param object defines the object to check.
	 * @returns true if the object is supported by this inspector.
	 */
	public static IsSupported(object: unknown): boolean {
		return isSpotLight(object);
	}

	public render(): ReactNode {
		const light = this.props.object;
		const softnessProxy = {
			get softness(): number {
				const angle = Math.max(0.001, light.angle);
				const inner = Math.max(0, light.innerAngle ?? 0);
				return Math.max(0, Math.min(1, 1 - inner / angle));
			},
			set softness(value: number) {
				const clamped = Math.max(0, Math.min(1, value));
				light.innerAngle = light.angle * (1 - clamped);
				onNodeModifiedObservable.notifyObservers(light);
			},
		};

		return (
			<>
				<EditorInspectorSectionField title="Common">
					<div className="flex justify-between items-center px-2 py-2">
						<div className="w-1/2">Type</div>

						<div className="text-white/50 w-full">{this.props.object.getClassName()}</div>
					</div>
					<EditorInspectorStringField
						label="Name"
						object={this.props.object}
						property="name"
						onChange={() => onNodeModifiedObservable.notifyObservers(this.props.object)}
					/>
				</EditorInspectorSectionField>

				<EditorInspectorSectionField title="Transforms">
					<EditorInspectorVectorField
						label={<div className="w-14">Position</div>}
						object={this.props.object}
						property="position"
						onChange={() => {
							updateLightShadowMapRefreshRate(this.props.object);
							updatePointLightShadowMapRenderListPredicate(this.props.object);
							onNodeModifiedObservable.notifyObservers(this.props.object);
						}}
					/>
					<EditorInspectorVectorField
						label={<div className="w-14">Direction</div>}
						object={this.props.object}
						property="direction"
						onChange={() => {
							updateLightShadowMapRefreshRate(this.props.object);
							updatePointLightShadowMapRenderListPredicate(this.props.object);
							onNodeModifiedObservable.notifyObservers(this.props.object);
						}}
					/>
				</EditorInspectorSectionField>

				<EditorInspectorSectionField title="Light">
					<EditorInspectorColorField label={<div className="w-14">Diffuse</div>} object={this.props.object} property="diffuse" />
					<EditorInspectorColorField label={<div className="w-14">Specular</div>} object={this.props.object} property="specular" />

					<Divider />

					<EditorInspectorNumberField
						label="Range"
						object={this.props.object}
						property="range"
						min={0}
						max={this.props.editor.layout.preview.camera.maxZ}
						step={this.props.editor.layout.preview.camera.maxZ / 1000}
						onChange={() => {
							updateLightShadowMapRefreshRate(this.props.object);
							updatePointLightShadowMapRenderListPredicate(this.props.object);
							onNodeModifiedObservable.notifyObservers(this.props.object);
						}}
					/>

					<Divider />

					<EditorInspectorNumberField label="Intensity" object={this.props.object} property="intensity" />

					<Divider />

					<EditorLightPBRInspector object={this.props.object} />
					<EditorLightClusterInspector light={this.props.object} editor={this.props.editor} />

					<Divider />

					<EditorInspectorListField
						object={this.props.object}
						property="falloffType"
						label="Falloff Type"
						items={[
							{ text: "Physical (Inverse Square)", value: Light.FALLOFF_PHYSICAL },
							{ text: "GLTF Standard", value: Light.FALLOFF_GLTF },
							{ text: "Standard Default", value: Light.FALLOFF_DEFAULT },
						]}
						onChange={() => onNodeModifiedObservable.notifyObservers(this.props.object)}
					/>
					<EditorInspectorNumberField
						label="Light Radius"
						object={this.props.object}
						property="radius"
						min={0}
						max={10}
						step={0.05}
						onChange={() => onNodeModifiedObservable.notifyObservers(this.props.object)}
					/>

					<Divider />

					<EditorInspectorNumberField
						asDegrees
						label="Angle"
						object={this.props.object}
						property="angle"
						min={0}
						max={Math.PI}
						step={0.1}
						onChange={() => {
							onNodeModifiedObservable.notifyObservers(this.props.object);
							this.forceUpdate();
						}}
					/>
					<EditorInspectorNumberField
						asDegrees
						label="Inner Angle"
						object={this.props.object}
						property="innerAngle"
						min={0}
						max={Math.PI}
						step={0.1}
						onChange={() => {
							onNodeModifiedObservable.notifyObservers(this.props.object);
							this.forceUpdate();
						}}
					/>
					<EditorInspectorNumberField
						label="Softness / Penumbra"
						object={softnessProxy}
						property="softness"
						min={0}
						max={1}
						step={0.01}
						onChange={() => {
							onNodeModifiedObservable.notifyObservers(this.props.object);
							this.forceUpdate();
						}}
					/>
					<EditorInspectorNumberField
						label="Exponent"
						object={this.props.object}
						property="exponent"
						onChange={() => onNodeModifiedObservable.notifyObservers(this.props.object)}
					/>
				</EditorInspectorSectionField>

				{/* <EditorInspectorSectionField title="Texture">
                    <EditorInspectorTextureField object={this.props.object} title="Projection Texture" property="projectionTexture" onChange={() => this.forceUpdate()} />
                </EditorInspectorSectionField> */}

				<ScriptInspectorComponent editor={this.props.editor} object={this.props.object} />

				<EditorLightShadowsInspector editor={this.props.editor} light={this.props.object} onShadowGeneratorChanged={() => this.forceUpdate()}>
					<EditorInspectorNumberField label="Angle" object={this.props.object} property="shadowAngleScale" min={0} max={Math.PI * 2} />
				</EditorLightShadowsInspector>

				<EditorLightVolumetricInspector editor={this.props.editor} light={this.props.object} />

				<CustomMetadataInspector object={this.props.object} />
			</>
		);
	}
}
