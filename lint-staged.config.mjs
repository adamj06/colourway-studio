// Same checks the agent gets, applied to human commits too.
const lintStagedConfig = {
  '*.{ts,tsx,js,jsx,mjs}': ['prettier --write', 'eslint --max-warnings 0'],
  '*.{css,json,md,yml}': ['prettier --write'],
};

export default lintStagedConfig;
