'use strict';

// Document de depart minimal, suffisant pour ensureSchema et loadStatusConfig.
function documentMinimal() {
    return {
        Tasks: {
            columns: {
                titre: { type: 'Text' },
                statut: {
                    type: 'Choice',
                    widgetOptions: JSON.stringify({
                        choices: ['todo', 'inprogress', 'review', 'done'],
                        choiceOptions: { done: { fillColor: '#10b981', textColor: '#ffffff' } }
                    })
                },
                projet: { type: 'Ref:Projects' },
                dateDebut: { type: 'Date' },
                dateEcheance: { type: 'Date' }
            },
            records: [{ id: 1, titre: 'Analyse', statut: 'todo' }]
        },
        Team: {
            columns: { nom: { type: 'Text' }, couleur: { type: 'Text' } },
            records: [
                { id: 1, nom: 'Alice', couleur: '#4f46e5' },
                { id: 2, nom: 'Bob', couleur: '#10b981' }
            ]
        }
    };
}

module.exports = { documentMinimal };
