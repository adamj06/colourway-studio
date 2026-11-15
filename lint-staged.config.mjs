// Same checks the agent gets, applied to human commits too.
const lintStagedConfig = {
  '*.{ts,tsx,js,jsx,mjs,cjs,mts,cts}': ['prettier --write', 'eslint --max-warnings 0 --no-warn-ignored'],
  '*.{css,json,md,yml,yaml}': ['prettier --write'],
};

export default lintStagedConfig;
