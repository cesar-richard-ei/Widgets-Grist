import js from '@eslint/js';
import globals from 'globals';
import html from 'eslint-plugin-html';

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
            'no-empty': ['error', { allowEmptyCatch: true }],
            // Les gabarits portent du texte affiche a l'utilisateur, ou l'espace
            // insecable des guillemets francais est voulu.
            'no-irregular-whitespace': ['error', { skipTemplates: true }]
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
        // Scripts de widget extraits, inlines dans le HTML par build-inline.js :
        // memes contraintes que le code en ligne, dont les fonctions appelees
        // depuis un attribut onclick et les globales apportees par le core.
        files: ['projects/tasks_app/*.js'],
        languageOptions: { globals: { ...globals.browser, grist: 'readonly' } },
        rules: {
            'no-undef': 'off',
            'no-unused-vars': 'off'
        }
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
        // Le JavaScript en ligne des widgets. Les fonctions y sont appelees depuis
        // des attributs onclick que le plugin ne voit pas, d'ou l'abandon de
        // no-unused-vars : le reste des regles garde tout son interet.
        files: ['**/*.html'],
        plugins: { html },
        languageOptions: {
            ecmaVersion: 2024,
            sourceType: 'script',
            globals: { ...globals.browser, grist: 'readonly' }
        },
        rules: {
            'no-undef': 'off',
            'no-unused-vars': 'off',
            // `<\/script>` est obligatoire dans un script en ligne : sans
            // l'echappement, la balise se ferme au milieu du code.
            'no-useless-escape': 'off'
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
