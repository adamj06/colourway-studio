// Conventional Commits. The Claude-Model trailer is a warning, not an error,
// because Adam's own hand-written commits legitimately won't have one.
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'trailer-exists': [1, 'always', 'Claude-Model:'],
    'body-max-line-length': [0],
  },
};
