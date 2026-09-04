'use strict';

const { test, expect } = require('@playwright/test');
const D = require('./documents.js');

// Saisir dans le volet et passer d'une ligne à l'autre. Deux mécanismes délicats se croisent ici :
//
// - une écriture Grist déclenche onRecords, donc un rendu, qui reconstruit #taskList et
//   #timelineGrid. Un rendu survenant entre le mousedown et le mouseup arrache la cible et le
//   navigateur n'émet aucun click : le clic est perdu et l'utilisateur doit recommencer. Le widget
//   diffère donc ses rendus pendant un geste souris.
// - la saisie en attente doit partir en base au bon moment, sans écriture parasite quand rien n'a
//   changé, ni perte quand on bascule vers une autre ligne.

const volet = (page) => page.locator('#panel');

async function ouvrirTache(page, titre) {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);
    await D.ouvrirVolet(page, titre || 'Cadrage des outils');
}

test('le volet s ouvre au clic et décale le Gantt', async ({ page }) => {
    await ouvrirTache(page);

    await expect(page.locator('#ganttWrapper')).toHaveClass(/panel-open/);
    await expect(page.locator('#taskTitle')).toBeVisible();
});

for (const [nom, fermer] of [
    ['la croix', async (page) => page.locator('#panel .panel-close, #panel .close-btn').first().click()],
    ['la touche Échap', async (page) => page.keyboard.press('Escape')]
]) {
    test(nom + ' ferme le volet', async ({ page }) => {
        await ouvrirTache(page);

        await fermer(page);

        await expect(volet(page)).not.toHaveClass(/open/);
    });
}

test('changer le statut part en base tout de suite', async ({ page }) => {
    await ouvrirTache(page);
    const avant = await D.champTache(page, 1, 'statut');

    const autre = page.locator('#panel .status-pill:not(.selected)').first();
    const cible = await autre.getAttribute('data-status');
    await autre.click();

    await expect(page.locator('#saveIndicator')).toHaveClass(/visible/);
    await expect.poll(() => D.champTache(page, 1, 'statut')).toBe(cible);
    expect(cible).not.toBe(avant);
});

test('la description part en base dès la perte du focus', async ({ page }) => {
    await ouvrirTache(page);

    await page.locator('#taskDescription').fill('Cadrage à valider avec le métier');
    await page.locator('#taskDescription').blur();

    await expect(page.locator('#saveIndicator')).toHaveClass(/visible/);
    await expect.poll(() => D.champTache(page, 1, 'description')).toBe('Cadrage à valider avec le métier');
});

test('le titre saisi part en base à la fermeture', async ({ page }) => {
    await ouvrirTache(page);

    await page.locator('#taskTitle').fill('Titre révisé');
    await page.keyboard.press('Escape');

    await expect.poll(() => D.champTache(page, 1, 'titre')).toBe('Titre révisé');
});

test('les flèches passent d une ligne à l autre', async ({ page }) => {
    await ouvrirTache(page);
    const premier = await page.locator('#taskTitle').inputValue();

    await page.locator('#panel .panel-nav-btn, #panel .nav-next').first().click();

    await expect(page.locator('#taskTitle')).not.toHaveValue(premier);
});

test('cliquer une autre ligne bascule le volet sans le fermer', async ({ page }) => {
    await ouvrirTache(page);

    await D.ligne(page, 'Recette').click();

    await expect(volet(page)).toHaveClass(/open/);
    await expect(page.locator('#taskTitle')).toHaveValue('Recette');
});

// Le premier clic doit suffire : c'est le cas que la garde de rendu protège, l'écriture déclenchée
// par la perte de focus provoquant un rendu au milieu du geste.
for (const [nom, champ, valeur] of [
    ['le titre', '#taskTitle', 'Titre modifié avant bascule'],
    ['la description', '#taskDescription', 'Description modifiée avant bascule']
]) {
    test('saisir ' + nom + ' puis cliquer une autre ligne bascule dès le premier clic', async ({ page }) => {
        await ouvrirTache(page);

        await page.locator(champ).fill(valeur);
        await D.ligne(page, 'Recette').click();

        await expect(volet(page)).toHaveClass(/open/);
        await expect(page.locator('#taskTitle')).toHaveValue('Recette');
        await expect.poll(() => D.champTache(page, 1, champ === '#taskTitle' ? 'titre' : 'description')).toBe(valeur);
    });
}

// Un glisser natif n'émet jamais de mouseup : sans désarmement dédié, la garde de rendu resterait
// armée et toute mise à jour suivante serait ignorée.
test('un glisser natif ne bloque pas les rendus suivants', async ({ page }) => {
    await ouvrirTache(page);

    await page.locator('#taskTitle').evaluate((el) => {
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        el.dispatchEvent(new DragEvent('dragstart', { bubbles: true }));
        el.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
    });
    await page.locator('#taskTitle').fill('Titre après glisser natif');
    await page.locator('#taskTitle').blur();

    await expect.poll(() => D.champTache(page, 1, 'titre')).toBe('Titre après glisser natif');
    await expect(D.ligne(page, 'Titre après glisser natif')).toHaveCount(1);
});

test('le Gantt et sa barre d outils restent utilisables volet ouvert', async ({ page }) => {
    await ouvrirTache(page);

    await page.locator('.view-controls .btn[data-view="month"]').click();
    await expect(page.locator('.view-controls .btn[data-view="month"]')).toHaveClass(/active/);
    await expect(volet(page)).toHaveClass(/open/);

    await page.locator('#timelineScroll').evaluate((el) => { el.scrollLeft = 200; });
    expect(await page.locator('#timelineScroll').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);

    // Aucun calque invisible ne doit recouvrir la zone de travail.
    const auCentre = await page.evaluate(() => {
        const g = document.getElementById('ganttWrapper').getBoundingClientRect();
        const el = document.elementFromPoint(g.left + g.width / 2, g.top + g.height / 2);
        return !!(el && el.closest('#ganttWrapper'));
    });
    expect(auCentre).toBe(true);
});

test('cliquer une poignée sans déplacer ouvre le volet, la tirer ne l ouvre pas', async ({ page }) => {
    await D.ouvrirGantt(page);
    await D.toutDeplier(page);
    const poignee = page.locator('#timelineGrid .gantt-bar .resize-handle.right').first();
    const boite = await poignee.boundingBox();

    await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(volet(page)).toHaveClass(/open/);

    await page.keyboard.press('Escape');
    await page.mouse.move(boite.x + boite.width / 2, boite.y + boite.height / 2);
    await page.mouse.down();
    await page.mouse.move(boite.x + boite.width / 2 + 120, boite.y + boite.height / 2, { steps: 10 });
    await page.mouse.up();

    await expect(volet(page)).not.toHaveClass(/open/);
});

// Saisir une année au clavier passe par des dates absurdes (0002, 0020, 0202) : les écrire
// déclencherait un rendu à chaque frappe et ferait sauter la timeline sous les doigts.
const ETAPES_ANNEE = ['0002-08-05', '0020-08-05', '0202-08-05'];

test('les dates intermédiaires d une saisie ne partent pas en base', async ({ page }) => {
    await ouvrirTache(page);
    const initiale = await D.champTache(page, 1, 'dateDebut');
    // La largeur de la grille suit l'etendue de la plage : elle bougerait si une date absurde
    // partait en base.
    const largeur = () => page.locator('#timelineGrid').evaluate((g) => g.style.width);
    const avant = await largeur();
    const champ = page.locator('#panel input[type="date"]').first();

    for (const etape of ETAPES_ANNEE) {
        await champ.fill(etape);
        expect(await D.champTache(page, 1, 'dateDebut')).toBe(initiale);
        expect(await largeur()).toBe(avant);
    }
});

test('l année complète, elle, est enregistrée', async ({ page }) => {
    await ouvrirTache(page);
    const champ = page.locator('#panel input[type="date"]').first();

    for (const etape of ETAPES_ANNEE) await champ.fill(etape);
    // Antérieure à l'échéance de la tâche : au-delà, l'enregistrement est refusé.
    await champ.fill('2026-07-06');

    await expect.poll(() => D.champTache(page, 1, 'dateDebut')).toBe(Math.floor(Date.UTC(2026, 6, 6) / 1000));
});

test('un titre long se lit en entier, sur plusieurs lignes', async ({ page }) => {
    await ouvrirTache(page, 'Analyse Plateforme');

    const m = await page.locator('#taskTitle').evaluate((el) => ({
        hauteur: el.getBoundingClientRect().height,
        debordement: el.scrollWidth - el.clientWidth
    }));
    expect(m.debordement).toBeLessThanOrEqual(1);
    expect(m.hauteur).toBeGreaterThan(60);
});

test('un titre court garde une hauteur sobre, qui suit la saisie', async ({ page }) => {
    await ouvrirTache(page, 'Recette');
    const hauteur = () => page.locator('#taskTitle').evaluate((el) => el.getBoundingClientRect().height);

    expect(await hauteur()).toBeLessThan(60);
    const avant = await hauteur();

    await page.locator('#taskTitle').fill('Recette fonctionnelle complète du parcours utilisateur de bout en bout');

    expect(await hauteur()).toBeGreaterThan(avant);
});

// Une fermeture ne doit écrire que s'il y a quelque chose à écrire : une écriture systématique
// marquerait le document comme modifié à chaque consultation.
const ecritures = (page) => page.evaluate(() => window.grist._log.length);

test('fermer sans rien modifier n écrit pas', async ({ page }) => {
    await ouvrirTache(page);
    const avant = await ecritures(page);

    await page.keyboard.press('Escape');

    expect(await ecritures(page)).toBe(avant);
});

test('la saisie part à la bascule, et la fermeture qui suit n écrit plus rien', async ({ page }) => {
    await ouvrirTache(page);

    // Saisie sans passer par le focus : un vrai clic puis un clic ailleurs déclencherait le blur
    // natif, qui enregistre par la voie normale avant la bascule et masquerait le défaut visé.
    await page.evaluate(() => {
        const champ = document.getElementById('taskDescription');
        champ.value = 'Description modifiée avant bascule';
        champ.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await D.ligne(page, 'Recette').click();
    await expect.poll(() => D.champTache(page, 1, 'description')).toBe('Description modifiée avant bascule');

    const avant = await ecritures(page);
    await page.keyboard.press('Escape');
    expect(await ecritures(page)).toBe(avant);
});
