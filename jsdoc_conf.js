'use-strict';

module.exports = {
	plugins: [],
	recurseDepth: 10,
	source: {
		include: ['index.js'],
		exclude: ['./node_modules'],
		includePattern: '.+\\.js(doc|x)?$',
		excludePattern: '(^|\\/|\\\\)_',
	},
	sourceType: 'module',
	tags: {
		allowUnknownTags: true,
		dictionaries: ['jsdoc', 'closure'],
	},
	templates: {
		cleverLinks: false,
		monospaceLinks: false,
	},
	opts: {
		template: 'templates/default', // same as -t templates/default
		encoding: 'utf8', // same as -e utf8
		destination: './jsdoc_out/', // same as -d ./out/
	},
};
