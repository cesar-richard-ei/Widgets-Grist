'use strict';

const { test, expect, ouvrirPremiereTache, ouvrirTacheAIndice, lireChampTache } = require('./harness.js');

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
    // La vue par defaut tient sans debordement horizontal ; on passe en vue semaine
    // pour garantir une timeline scrollable et verifier que le panneau ouvert ne
    // bloque pas le defilement.
    await gantt.locator('.view-controls .btn[data-view="week"]').click();
    await gantt.locator('#timelineScroll').evaluate((el) => { el.scrollLeft = 200; });
    const position = await gantt.locator('#timelineScroll').evaluate((el) => el.scrollLeft);
    expect(position).toBeGreaterThan(0);
});

test('aucun calque ne recouvre le Gantt', async ({ gantt }) => {
    await ouvrirPremiereTache(gantt);

    // Verifie l'element reellement rendu au centre de la zone Gantt, plutot que l'absence
    // d'un identifiant particulier : un calque bloquant reintroduit sous un autre nom passerait
    // inapercu si on se contentait de chercher #panelOverlay, qui n'existe plus.
    const centreEstDansLeGantt = await gantt.evaluate(() => {
        const zone = document.getElementById('timelineScroll').getBoundingClientRect();
        const cx = zone.left + zone.width / 2;
        const cy = zone.top + zone.height / 2;
        const el = document.elementFromPoint(cx, cy);
        return !!el && !!el.closest('#timelineScroll, #timelineGrid, #taskList');
    });
    expect(centreEstDansLeGantt).toBe(true);
});

test('changer de tache panneau ouvert persiste la modification en attente', async ({ gantt }) => {
    const premierId = await ouvrirTacheAIndice(gantt, 0);

    // Geste reel : clic dans le champ puis frappe au clavier. Un fill() declencherait
    // immediatement l'evenement change et masquerait le defaut vise, comme documente dans
    // panneau.spec.js pour le meme motif.
    await gantt.locator('#taskDescription').click();
    await gantt.keyboard.type('Description modifiee avant bascule');

    await gantt.locator('#taskList .task-row').nth(1).click();
    await expect(gantt.locator('#panel')).toHaveClass(/open/);

    const description = await lireChampTache(gantt, premierId, 'description');
    expect(description).toBe('Description modifiee avant bascule');
});

// Les deux poignees de redimensionnement font 8px chacune : sur une barre courte elles
// couvrent toute la largeur, et le clic d'ouverture atterrit forcement sur l'une d'elles.
test('cliquer une poignee sans deplacer ouvre le panneau', async ({ gantt }) => {
    const barre = gantt.locator('#timelineGrid .gantt-bar:not(.parent)').first();
    await barre.locator('.resize-handle.left').click();
    await expect(gantt.locator('#panel')).toHaveClass(/open/);
});

test('redimensionner par la poignee n ouvre pas le panneau', async ({ gantt }) => {
    const poignee = gantt.locator('#timelineGrid .gantt-bar:not(.parent)').first().locator('.resize-handle.right');
    const boite = await poignee.boundingBox();
    const y = boite.y + boite.height / 2;

    await gantt.mouse.move(boite.x + boite.width / 2, y);
    await gantt.mouse.down();
    await gantt.mouse.move(boite.x + boite.width / 2 + 120, y, { steps: 5 });
    await gantt.mouse.up();

    await expect(gantt.locator('#panel')).not.toHaveClass(/open/);
});
