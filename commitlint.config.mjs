// Conventional Commits. The Claude-Model and Feature trailers are warnings, not errors,
// because Adam's own hand-written commits legitimately won't have them.
const commitlintConfig = {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        // trailer-exists takes a single trailer, so the second one (CLAUDE.md: "Feature: <build-log feature id>") is custom.
        'feature-trailer': (parsed) => {
          const present = /^Feature:\s*\S+/m.test(`${parsed.footer ?? ''}`);
          return [present, 'add a "Feature: <build-log feature id>" trailer (CLAUDE.md)'];
        },
      },
    },
  ],
  rules: {
    'trailer-exists': [1, 'always', 'Claude-Model:'],
    'feature-trailer': [1, 'always'],
    'body-max-line-length': [0],
  },
};

export default commitlintConfig;
