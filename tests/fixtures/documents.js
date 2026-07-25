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

// Document deja peuple : toutes les colonnes du schema presentes, donc ensureSchema
// ne cree/n'ajoute rien (cas "chaud", ou la double lecture des tables se produit).
function documentComplet() {
    return {
        Team: {
            columns: { nom: { type: 'Text' }, email: { type: 'Text' }, avatar: { type: 'Text' }, role: { type: 'Choice' }, actif: { type: 'Bool' }, couleur: { type: 'Text' } },
            records: [{ id: 1, nom: 'Alice', actif: true }, { id: 2, nom: 'Bob', actif: true }]
        },
        Projects: {
            columns: { nom: { type: 'Text' }, couleur: { type: 'Text' }, dateDebut: { type: 'Date' }, dateFin: { type: 'Date' }, responsable: { type: 'Ref:Team' }, actif: { type: 'Bool' } },
            records: [{ id: 1, nom: 'Refonte', actif: true }]
        },
        Tasks: {
            columns: {
                titre: { type: 'Text' }, description: { type: 'Text' }, dateDebut: { type: 'Date' }, dateEcheance: { type: 'Date' },
                priorite: { type: 'Choice' }, statut: { type: 'Choice', widgetOptions: JSON.stringify({ choices: ['todo', 'inprogress', 'review', 'done'] }) },
                progression: { type: 'Numeric' }, projet: { type: 'Ref:Projects' }, assignees: { type: 'RefList:Team' }, type: { type: 'Choice' },
                dependDe: { type: 'RefList:Tasks' }, tags: { type: 'ChoiceList' }, estimationH: { type: 'Numeric' }, tempsPasse: { type: 'Numeric' },
                couleur: { type: 'Text' }, subtasks: { type: 'Text' }, parentTask: { type: 'Ref:Tasks' }
            },
            records: [
                { id: 1, titre: 'A', statut: 'todo', priorite: '1', projet: 1, type: 'tache', dateDebut: 1750000000, dateEcheance: 1751000000 },
                { id: 2, titre: 'B', statut: 'done', priorite: '2', projet: 1, type: 'tache', dateDebut: 1750000000, dateEcheance: 1751000000 }
            ]
        }
    };
}

module.exports = { documentMinimal, documentComplet };
