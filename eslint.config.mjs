import js from '@eslint/js';
import globals from 'globals';

// Les widgets sont du HTML autonome avec leur JavaScript en ligne : seuls les
// fichiers .js sont analyses ici.
export default [
    {
        ignores: [
            'node_modules/**',
            'published/**',
            'test-results/**',
            'playwright-report/**',
            'blob-report/**'
        ]
    },

    js.configs.recommended,

    {
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'commonjs',
            globals: globals.node
        },
        rules: {
            'no-unused-vars': ['error', { caughtErrors: 'none' }],
            // Les replis silencieux sont un parti pris du depot : un widget sans
            // Grist doit continuer a s'afficher.
            'no-empty': ['error', { allowEmptyCatch: true }]
        }
    },

    {
        files: ['**/*.mjs'],
        languageOptions: { sourceType: 'module' }
    },

    {
        // Le core est charge par les widgets dans le navigateur et par les tests
        // sous Node.
        files: ['projects/tasks_app/core/**/*.js'],
        languageOptions: { globals: { ...globals.browser, ...globals.node, grist: 'readonly' } }
    },

    {
        files: ['projects/Atlas/**/*.js'],
        languageOptions: {
            sourceType: 'module',
            // maplibregl et SunCalc arrivent par balise script dans le widget.
            globals: { ...globals.browser, grist: 'readonly', maplibregl: 'readonly', SunCalc: 'readonly' }
        }
    },

    {
        // Les callbacks passes a page.evaluate() s'executent dans la page et
        // referencent les globales du widget, invisibles depuis ici.
        files: ['tests/**/*.js'],
        languageOptions: { globals: { ...globals.node, ...globals.browser } },
        rules: { 'no-undef': 'off' }
    }
];
