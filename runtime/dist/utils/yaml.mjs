import YAML from "yaml";
//#region src/utils/yaml.ts
function parseYaml(text) {
	return YAML.parse(text);
}
function toYaml(value) {
	return YAML.stringify(value, { lineWidth: 0 });
}
//#endregion
export { parseYaml, toYaml };
