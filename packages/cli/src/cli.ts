/** Programmatic CLI facade used by tests and embedding hosts. */
export { runCli } from './main.ts';
export {
  formatCliError,
  formatCliOutput,
  type CliExecution,
} from './presentation/output.ts';
export type {
  PromptProvider,
  RunCliOptions,
} from './runtime-context.ts';
