# Infrastructure de test, phase 1

**But :** pouvoir piloter un widget dans un navigateur sans instance Grist, puis corriger les
tickets #8, #9, #4 et #11 en écrivant d'abord le test qui échoue.

**Approche :** Playwright charge `gantt.html` servi en local, avec le simulacre injecté avant le
script de la page. Le widget croit parler à Grist. Le document de départ est **vide** : c'est
`ensureSchema()` puis `seedData()` du widget lui-même qui construisent les tables et les données,
ce qui supprime toute fixture à maintenir et exerce le chemin réel.

**Outillage :** `@playwright/test`, Chromium. Première dépendance du dépôt.

## Contraintes globales

- Node 20 en intégration continue.
- Le simulacre `tests/fake-grist.js` reste la seule couche entre le widget et Grist.
- Ne jamais éditer la copie du core inlinée dans les `.html`. Éditer le source puis
  `npm run build:taskflow`.
- Commentaires et messages en français, pas de tiret cadratin (`—` ou `–`).
- Aucune trace d'assistance par IA nulle part.
- Toute modification de `gantt.html` doit rester minimale et ciblée sur le ticket traité.

## Deux pièges relevés à l'analyse

**Le simulacre lève dans un navigateur.** `tests/fake-grist.js` se termine par un
`module.exports` non gardé. Injecté tel quel, il produit une `ReferenceError` avant toute chose.
Il faut la même garde que celle posée sur le core en phase 0.

**La vraie API Grist écraserait le simulacre.** `gantt.html:568` charge
`https://docs.getgrist.com/grist-plugin-api.js`, qui définit `window.grist` au chargement. Cette
requête doit être bloquée dans les tests.

## Structure des fichiers

| Fichier | Responsabilité |
|---------|----------------|
| `playwright.config.js` | Configuration, serveur local, navigateur |
| `tests/fake-grist.js` | Modifié : garde d'export pour usage navigateur |
| `tests/e2e/harness.js` | Fixture Playwright : blocage du CDN, injection, attente du rendu |
| `tests/e2e/panneau.spec.js` | Caractérisation du panneau, puis #8 et #9 |
| `tests/e2e/interaction.spec.js` | #4 et #11 |
| `projects/tasks_app/gantt.html` | Modifié : correctifs des quatre tickets |

---

### Tâche 1 : socle Playwright

**Fichiers :**
- Modifier : `tests/fake-grist.js` (fin de fichier)
- Créer : `playwright.config.js`, `tests/e2e/harness.js`, `tests/e2e/fumee.spec.js`
- Modifier : `package.json`, `.gitignore`

**Interfaces :**
- Produit : `test` et `expect` exportés par `tests/e2e/harness.js`, avec une fixture `gantt` qui
  rend une `page` déjà chargée, simulacre injecté et première tâche rendue.

- [ ] **Étape 1 : installer la dépendance**

```
npm install --save-dev @playwright/test
npx playwright install chromium
```

- [ ] **Étape 2 : garder l'export du simulacre**

Dans `tests/fake-grist.js`, remplacer la dernière ligne :

```js
module.exports = { createFakeGrist };
```

par :

```js
// Export Node pour les tests unitaires. Inerte dans le navigateur, ou le simulacre
// est injecte comme script global et expose createFakeGrist sur window.
if (typeof module !== 'undefined' && module.exports) module.exports = { createFakeGrist };
```

- [ ] **Étape 3 : vérifier que les tests unitaires passent toujours**

```
npm test
```

Attendu : 66 tests verts. La garde ne change rien côté Node.

- [ ] **Étape 4 : écrire la configuration**

`playwright.config.js` :

```js
'use strict';

const config = {
    testDir: './tests/e2e',
    timeout: 20000,
    use: {
        baseURL: 'http://localhost:3001',
        trace: 'retain-on-failure'
    },
    webServer: {
        command: 'node scripts/serve-dev.js',
        url: 'http://localhost:3001/tasks_app/gantt.html',
        reuseExistingServer: true,
        timeout: 15000
    }
};

module.exports = config;
```

- [ ] **Étape 5 : écrire le harnais**

`tests/e2e/harness.js` :

```js
'use strict';

const path = require('path');
const base = require('@playwright/test');

const CHEMIN_SIMULACRE = path.join(__dirname, '..', 'fake-grist.js');

// Le document de depart est vide : ensureSchema() puis seedData() du widget construisent
// eux-memes les tables et les donnees. Rien a maintenir cote fixture, et le chemin reel
// d'initialisation est exerce a chaque test.
const test = base.test.extend({
    gantt: async ({ page }, use) => {
        // La vraie API Grist definirait window.grist et ecraserait le simulacre.
        await page.route('**/grist-plugin-api.js', (route) => route.abort());

        await page.addInitScript({ path: CHEMIN_SIMULACRE });
        await page.addInitScript(() => { window.grist = window.createFakeGrist({}); });

        await page.goto('/tasks_app/gantt.html');
        await page.waitForSelector('#taskList .task-row');
        await use(page);
    }
});

module.exports = { test: test, expect: base.expect };
```

- [ ] **Étape 6 : écrire le test de fumée**

`tests/e2e/fumee.spec.js` :

```js
'use strict';

const { test, expect } = require('./harness.js');

test('le widget construit son schema et affiche les taches semees', async ({ gantt }) => {
    await expect(gantt.locator('#taskList .task-row')).toHaveCount(10);

    const tables = await gantt.evaluate(() => window.grist.docApi.listTables());
    expect(tables.sort()).toEqual(['Projects', 'Tasks', 'Team']);
});

test('le mode demonstration ne se declenche pas quand des taches existent', async ({ gantt }) => {
    // Le repli automatique du widget se declenche a 2800 ms si aucune tache n'est chargee.
    await gantt.waitForTimeout(3200);
    await expect(gantt.locator('.demo-badge')).toHaveCount(0);
});
```

- [ ] **Étape 7 : lancer les tests de bout en bout**

```
npx playwright test
```

Attendu : 2 tests verts. Si le premier échoue sur le nombre de tâches, lire le nombre réel semé
par `seedData` dans `gantt.html` et corriger l'attente, en documentant l'écart.

- [ ] **Étape 8 : déclarer la commande et ignorer les artefacts**

Dans `package.json`, ajouter :

```json
"test:e2e": "playwright test"
```

Dans `.gitignore`, ajouter :

```
# Playwright
/test-results/
/playwright-report/
/blob-report/
```

- [ ] **Étape 9 : commit**

```bash
git add tests/fake-grist.js playwright.config.js tests/e2e/ package.json package-lock.json .gitignore
git commit -m "test(taskflow): socle Playwright pour piloter les widgets"
```

---

### Tâche 2 : caractériser le panneau avant correction

**Fichiers :**
- Créer : `tests/e2e/panneau.spec.js`

**Interfaces :**
- Consomme : la fixture `gantt` de la tâche 1.

Ces tests figent le comportement **actuel**, bugs compris. Ils servent de filet pour les tâches
suivantes : après correction, seuls les tests visant explicitement un ticket doivent changer.

- [ ] **Étape 1 : écrire les tests**

`tests/e2e/panneau.spec.js` :

```js
'use strict';

const { test, expect } = require('./harness.js');

async function ouvrirPremiereTache(page) {
    await page.locator('#taskList .task-row').first().click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
}

test('cliquer une tache ouvre le panneau et decale le Gantt', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await expect(gantt.locator('#ganttWrapper')).toHaveClass(/panel-open/);
    await expect(gantt.locator('#taskTitle')).toBeVisible();
});

test('la croix ferme le panneau', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#panelHeader .panel-close').click();
    await expect(gantt.locator('#panel')).not.toHaveClass(/open/);
});

test('la touche Echap ferme le panneau', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.keyboard.press('Escape');
    await expect(gantt.locator('#panel')).not.toHaveClass(/open/);
});

test('changer le statut persiste immediatement', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('.status-pill[data-status="done"]').click();
    await expect(gantt.locator('#saveIndicator')).toHaveClass(/visible/);

    const statut = await gantt.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t.statut[0];
    });
    expect(statut).toBe('done');
});

test('les fleches naviguent entre les taches', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    const premier = await gantt.locator('#taskTitle').inputValue();
    await gantt.locator('#panelHeader .panel-nav-btn').last().click();
    const suivant = await gantt.locator('#taskTitle').inputValue();
    expect(suivant).not.toBe(premier);
});
```

- [ ] **Étape 2 : lancer**

```
npx playwright test tests/e2e/panneau.spec.js
```

Attendu : 5 verts. Ce sont des tests de caractérisation, ils décrivent l'existant.

Si l'un échoue, établir le comportement réel dans `gantt.html`, corriger l'attente, documenter.
Ne modifier aucun code de production dans cette tâche.

- [ ] **Étape 3 : commit**

```bash
git add tests/e2e/panneau.spec.js
git commit -m "test(taskflow): fige le comportement du panneau du Gantt"
```

---

### Tâche 3 : tickets #8 et #9, persistance du titre et de la description

**Fichiers :**
- Modifier : `tests/e2e/panneau.spec.js`
- Modifier : `projects/tasks_app/gantt.html` lignes 1049, 2283, 2358, 2060, 2418

**Le défaut.** Le titre (l. 2283) et la description (l. 2358) appellent
`updateField(..., true)`, dont le troisième argument vaut `noSave`. La ligne 2448 ne persiste que
si `noSave` est faux. Aucun `onblur` ni `onchange` ne compense. `closePanel` (l. 2060) remet
`editData` à `null` sans écrire. La saisie est donc perdue, sauf si l'utilisateur touche ensuite
un autre champ, qui réémet le record complet.

Ce sont les **deux seuls** appels avec `noSave` du fichier.

- [ ] **Étape 1 : écrire les tests qui échouent**

À ajouter à `tests/e2e/panneau.spec.js` :

```js
test('la description saisie est persistee a la fermeture du panneau', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#taskDescription').fill('Cadrage a valider avec le metier');
    await gantt.locator('#panelHeader .panel-close').click();

    const description = await gantt.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t.description[0];
    });
    expect(description).toBe('Cadrage a valider avec le metier');
});

test('le titre saisi est persiste a la fermeture du panneau', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#taskTitle').fill('Titre revise');
    await gantt.locator('#panelHeader .panel-close').click();

    const titre = await gantt.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t.titre[0];
    });
    expect(titre).toBe('Titre revise');
});

test('la saisie est persistee meme en fermant par Echap', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#taskDescription').fill('Saisie fermee au clavier');
    await gantt.keyboard.press('Escape');

    const description = await gantt.evaluate(async () => {
        const t = await window.grist.docApi.fetchTable('Tasks');
        return t.description[0];
    });
    expect(description).toBe('Saisie fermee au clavier');
});

test('quitter le champ persiste sans fermer le panneau', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#taskDescription').fill('Persistee en quittant le champ');
    await gantt.locator('#taskTitle').click();
    await expect(gantt.locator('#saveIndicator')).toHaveClass(/visible/);
});

test('fermer sans rien modifier n emet aucune ecriture', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    const avant = await gantt.evaluate(() => window.grist._log.length);
    await gantt.locator('#panelHeader .panel-close').click();
    const apres = await gantt.evaluate(() => window.grist._log.length);
    expect(apres).toBe(avant);
});
```

- [ ] **Étape 2 : lancer et vérifier l'échec**

```
npx playwright test tests/e2e/panneau.spec.js
```

Attendu : les quatre premiers nouveaux tests échouent. Le premier échouera d'abord sur
`#taskDescription`, qui n'existe pas encore.

- [ ] **Étape 3 : donner un ancrage stable à la description**

`gantt.html` ligne 2358, ajouter l'identifiant et le déclencheur de persistance :

```js
                '<div class="form-group"><textarea class="form-textarea" id="taskDescription" placeholder="' + descLabel + '..." oninput="updateField(\'description\', this.value, true)" onchange="updateField(\'description\', this.value)"></textarea></div></div>' +
```

Attention, le contenu du textarea reste `escapeHtml(data.description)` entre les balises,
conserver la fin de ligne existante.

- [ ] **Étape 4 : même déclencheur sur le titre**

`gantt.html` ligne 2283 :

```js
                '<input type="text" class="panel-title-edit" id="taskTitle" placeholder="' + titlePlaceholder + '" value="' + escapeHtml(data.titre) + '" oninput="updateField(\'titre\', this.value, true)" onchange="updateField(\'titre\', this.value)">' +
```

`onchange` ne se déclenche qu'à la perte de focus et seulement si la valeur a changé. Il n'y a
donc pas d'écriture par frappe, ce qui compte puisque le fichier ne dispose d'aucun anti-rebond.

- [ ] **Étape 5 : marquer les modifications non persistées**

`gantt.html` ligne 1049, ajouter le champ `dirty` à l'état du panneau :

```js
        let panelState = { open: false, isNew: false, taskId: null, taskIndex: -1, taskList: [], editData: null, dirty: false };
```

Dans `updateField`, remplacer la ligne 2448 par :

```js
            if (noSave) panelState.dirty = true;
            if (!panelState.isNew && !noSave && gristReady) { panelState.dirty = false; saveTaskToGrist(); }
```

- [ ] **Étape 6 : vider les modifications en attente à la fermeture**

Dans `closePanel`, `gantt.html` ligne 2060, insérer avant la réinitialisation de `panelState` :

```js
        function closePanel() {
            // Ecrit la saisie en cours du titre ou de la description, que rien d'autre ne persiste.
            if (panelState.dirty && !panelState.isNew && gristReady) saveTaskToGrist();
            panelState.open = false;
```

`saveTaskToGrist` lit `panelState.editData` et `panelState.taskId` de façon synchrone avant sa
première attente, l'appeler juste avant la réinitialisation est donc sûr.

Ajouter `dirty: false` dans l'objet réassigné à la ligne 2065, et dans celui de
`openCreateTaskWithParent` ligne 2098.

- [ ] **Étape 7 : lancer et vérifier le succès**

```
npx playwright test tests/e2e/panneau.spec.js
npm test
```

Attendu : tous verts, unitaires compris.

- [ ] **Étape 8 : commit**

```bash
git add projects/tasks_app/gantt.html tests/e2e/panneau.spec.js
git commit -m "fix(gantt): persiste le titre et la description du panneau"
```

---

### Tâche 4 : tickets #4 et #11, calque bloquant

**Fichiers :**
- Créer : `tests/e2e/interaction.spec.js`
- Modifier : `projects/tasks_app/gantt.html` lignes 204, 205, 657, 1050, 2057, 2064, 3077 à 3083

**Le défaut.** `.panel-overlay` recouvre la zone du Gantt dès l'ouverture du panneau, avec
`pointer-events: auto`. Tout clic y est capté et ferme le panneau. D'où l'impossibilité de
basculer sur une autre tâche (#4) et de manipuler le Gantt panneau ouvert (#11).

**Décision retenue :** le calque disparaît. Fermeture par la croix ou Échap. Cliquer une autre
tâche bascule le panneau dessus.

Note : sous 700 pixels, `--panel-width` vaut `100%`, donc `right: 100%` donne déjà au calque une
largeur nulle. Le retrait ne change rien sur écran étroit.

- [ ] **Étape 1 : écrire les tests qui échouent**

`tests/e2e/interaction.spec.js` :

```js
'use strict';

const { test, expect } = require('./harness.js');

async function ouvrirPremiereTache(page) {
    await page.locator('#taskList .task-row').first().click();
    await expect(page.locator('#panel')).toHaveClass(/open/);
}

test('cliquer une autre tache bascule le panneau sans le fermer', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    const premier = await gantt.locator('#taskTitle').inputValue();

    await gantt.locator('#taskList .task-row').nth(1).click();

    await expect(gantt.locator('#panel')).toHaveClass(/open/);
    const second = await gantt.locator('#taskTitle').inputValue();
    expect(second).not.toBe(premier);
});

test('le Gantt reste cliquable quand le panneau est ouvert', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#timelineGrid .gantt-bar').first().click();
    await expect(gantt.locator('#panel')).toHaveClass(/open/);
});

test('la barre d outils reste utilisable quand le panneau est ouvert', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('.view-controls .btn[data-view="month"]').click();
    await expect(gantt.locator('.view-controls .btn[data-view="month"]')).toHaveClass(/active/);
    await expect(gantt.locator('#panel')).toHaveClass(/open/);
});

test('la timeline defile quand le panneau est ouvert', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await gantt.locator('#timelineScroll').evaluate((el) => { el.scrollLeft = 200; });
    const position = await gantt.locator('#timelineScroll').evaluate((el) => el.scrollLeft);
    expect(position).toBeGreaterThan(0);
});

test('aucun calque ne recouvre le Gantt', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);
    await expect(gantt.locator('#panelOverlay')).toHaveCount(0);
});
```

- [ ] **Étape 2 : lancer et vérifier l'échec**

```
npx playwright test tests/e2e/interaction.spec.js
```

Attendu : les tests échouent, le panneau se fermant à chaque clic.

- [ ] **Étape 3 : retirer les listeners du calque**

`gantt.html`, supprimer les lignes 3077 à 3083 :

```js
        const panelOverlay = document.getElementById('panelOverlay');
        panelOverlay.addEventListener('mousedown', (e) => { overlayPointerStart = { x: e.clientX, y: e.clientY }; });
        panelOverlay.addEventListener('mouseup', (e) => {
            const dx = Math.abs(e.clientX - overlayPointerStart.x);
            const dy = Math.abs(e.clientY - overlayPointerStart.y);
            if (dx < 5 && dy < 5) confirmClosePanel();
        });
```

- [ ] **Étape 4 : retirer les manipulations du calque**

Supprimer la ligne 2057 dans `openPanel` :

```js
            document.getElementById('panelOverlay').classList.add('visible');
```

et la ligne 2064 dans `closePanel` :

```js
            document.getElementById('panelOverlay').classList.remove('visible');
```

- [ ] **Étape 5 : retirer l'élément, son style et sa variable**

Supprimer la ligne 657, l'élément `<div class="panel-overlay" id="panelOverlay"></div>`.

Supprimer les règles CSS des lignes 204 et 205, `.panel-overlay` et `.panel-overlay.visible`.

Supprimer la ligne 1050, `let overlayPointerStart = { x: 0, y: 0 };`, devenue sans usage.

Vérifier par recherche qu'aucune autre occurrence de `panelOverlay`, `panel-overlay` ou
`overlayPointerStart` ne subsiste.

- [ ] **Étape 6 : lancer et vérifier le succès**

```
npx playwright test
npm test
```

Attendu : tous verts. Les tests de caractérisation de la tâche 2 doivent toujours passer :
l'ouverture, la croix, Échap et la navigation ne dépendent pas du calque.

- [ ] **Étape 7 : commit**

```bash
git add projects/tasks_app/gantt.html tests/e2e/interaction.spec.js
git commit -m "fix(gantt): retire le calque qui bloquait le Gantt panneau ouvert"
```

---

### Tâche 5 : intégration continue et documentation

**Fichiers :**
- Modifier : `.github/workflows/tests.yml`, `docs/infra-de-test.md`

- [ ] **Étape 1 : ajouter les tests de bout en bout à la CI**

Dans `.github/workflows/tests.yml`, après l'étape des tests unitaires :

```yaml
      - name: Installation des dependances
        run: npm ci

      - name: Installation du navigateur
        run: npx playwright install --with-deps chromium

      - name: Tests de bout en bout
        run: npm run test:e2e
```

L'étape d'installation des dépendances devient nécessaire, le dépôt n'étant plus sans
dépendance. La placer avant les tests unitaires.

- [ ] **Étape 2 : mettre la conception à jour**

Dans `docs/infra-de-test.md`, corriger la phrase « Aucune dépendance en phase 0 », devenue
trompeuse une fois Playwright installé, et consigner dans le registre des divergences que la
forme du second argument de `onOptions` reste à confronter à l'instance réelle.

- [ ] **Étape 3 : vérifier**

```
npm test
npm run check:taskflow
npx playwright test
```

- [ ] **Étape 4 : commit**

```bash
git add .github/workflows/tests.yml docs/infra-de-test.md
git commit -m "ci: execute les tests de bout en bout"
```

---

## Vérification de fin de phase

- [ ] Les trois commandes de la CI passent en local.
- [ ] Ouvrir `gantt.html` dans un navigateur, panneau ouvert : le Gantt reste cliquable et
      défilable, cliquer une autre tâche bascule le panneau, la croix et Échap ferment.
- [ ] Saisir une description, fermer, rouvrir la tâche : la description est là.
- [ ] `npm run build:taskflow --check` passe, aucune modification n'ayant touché le core.

## Hors périmètre

Restent au backlog : #7, #10, #3, #5, ainsi que les deux défauts relevés à l'analyse, le mode
démonstration qui s'invite dans un document vide et Échap qui ferme depuis un champ de saisie.
Ce dernier devient sans conséquence une fois la tâche 3 appliquée, la saisie étant alors écrite
à la fermeture.
