const fs = require('fs');
const T0 = Date.parse('2026-03-10T15:00:00.000Z');
const H = 3600000;
const iso = (ms) => new Date(ms).toISOString();
const profile = (o = {}) => ({
  hunger: 100, cleanliness: 100, happiness: 100, energy: 100, pawTokens: 0,
  adoptionDate: iso(T0 - 60 * 24 * H), lastUpdatedAt: iso(T0), isSleeping: false, isSick: false,
  poopPiles: [], nextPoopEventAt: '', needsBath: false, paidStageIndex: 0, hatchedAt: '', lastBathCompletedAt: '', ...o,
});
const U = 27720;
const ev = (type, at) => ({ id: `${type}:${at}`, type, at });
const lc = (o = {}) => ({ state: 'healthy', exhausted: false, lastEvaluatedAt: iso(T0), ...o });
const pets = [
  { id: 'pet-1700000000000', name: 'Biscuit', profile: profile({ hunger: 80, cleanliness: 70, happiness: 60, energy: 90, paidStageIndex: 4, adoptionDate: iso(T0 - 90 * 24 * H), hatchedAt: iso(T0 - 70 * 24 * H) }),
    growthUnits: 50 * U, tasksCounted: 50, lifecycle: lc(), equipped: { hat: 'hat-1', bow: null },
    events: [ev('adopted', iso(T0 - 90 * 24 * H)), ev('hatched', iso(T0 - 70 * 24 * H))], peak: { stageIndex: 4, level: 5 }, createdAt: iso(T0 - 90 * 24 * H) },
  { id: 'pet-1700000000001', name: 'Mochi', profile: profile({ hunger: 0, cleanliness: 60, happiness: 55, energy: 70, paidStageIndex: 0, hatchedAt: iso(T0 - 30 * 24 * H) }),
    growthUnits: 14 * U, tasksCounted: 14, lifecycle: lc({ state: 'sick', sickSince: iso(T0 - 2 * H) }),
    equipped: { hat: null, bow: null }, events: [ev('adopted', iso(T0 - 40 * 24 * H)), ev('hatched', iso(T0 - 30 * 24 * H)), ev('sick', iso(T0 - 2 * H))], peak: { stageIndex: 1, level: 2 }, createdAt: iso(T0 - 40 * 24 * H) },
  { id: 'pet-1700000000002', name: 'Luna', profile: profile({ hunger: 0, cleanliness: 0, happiness: 20, energy: 40, hatchedAt: iso(T0 - 20 * 24 * H) }),
    growthUnits: 12 * U, tasksCounted: 12, lifecycle: lc({ state: 'critical', sickSince: iso(T0 - 30 * H), criticalSince: iso(T0 - 6 * H) }),
    equipped: { hat: null, bow: null }, events: [ev('adopted', iso(T0 - 25 * 24 * H)), ev('hatched', iso(T0 - 20 * 24 * H)), ev('sick', iso(T0 - 30 * H)), ev('critical', iso(T0 - 6 * H))], peak: { stageIndex: 1, level: 2 }, createdAt: iso(T0 - 25 * 24 * H) },
  { id: 'pet-1700000000003', name: 'Shadow', profile: profile({ hunger: 0, cleanliness: 0, happiness: 0, energy: 10, paidStageIndex: 3, hatchedAt: iso(T0 - 100 * 24 * H) }),
    growthUnits: 42 * U, tasksCounted: 42, lifecycle: lc({ state: 'deceased', sickSince: iso(T0 - 14 * 24 * H), criticalSince: iso(T0 - 13 * 24 * H), diedAt: iso(T0 - 10 * 24 * H) }),
    equipped: { hat: null, bow: 'bow-1' }, events: [ev('adopted', iso(T0 - 110 * 24 * H)), ev('hatched', iso(T0 - 100 * 24 * H)), ev('died', iso(T0 - 10 * 24 * H))], peak: { stageIndex: 3, level: 4 }, createdAt: iso(T0 - 110 * 24 * H) },
  { id: 'pet-1700000000004', name: 'Sunny', profile: profile({ hunger: 55, cleanliness: 45, happiness: 65, energy: 50, hatchedAt: iso(T0 - 50 * 24 * H) }),
    growthUnits: 22 * U, tasksCounted: 22, lifecycle: lc(), equipped: { hat: null, bow: null }, retired: { since: iso(T0 - 5 * 24 * H) },
    events: [ev('adopted', iso(T0 - 60 * 24 * H)), ev('hatched', iso(T0 - 50 * 24 * H)), ev('retired', iso(T0 - 5 * 24 * H))], peak: { stageIndex: 2, level: 3 }, createdAt: iso(T0 - 60 * 24 * H) },
];
const family = { version: 1, selectedPetId: 'pet-1700000000000', pets, wallet: { pawTokens: 640 }, supplies: { washcloth: 2, medicine: 1 }, toys: { 'yarn-ball': 1 } };
fs.writeFileSync('tests/fixtures/family-v1-mixed.json', JSON.stringify({ '@ProductivityPet:petFamily': family }, null, 2) + '\n');

// Legacy single-pet save (before the pet family existed): the family record is absent.
const task = (id, o) => ({ id, text: id, category: 'Home', important: false, kind: 'task', date: '2026-03-01', completed: false, ...o });
const tasks = [];
for (let i = 0; i < 12; i++) tasks.push(task(`t${i}`, { completed: true, important: i % 4 === 0 }));
tasks.push(task('daily', { repeat: { kind: 'daily' }, completedDates: ['2026-03-01', '2026-03-02', '2026-03-03'] }));
tasks.push(task('appt', { kind: 'event', completed: true }));
tasks.push(task('open', {}));
const legacy = {
  '@ProductivityPet:petProfile': profile({ hunger: 0, cleanliness: 35, happiness: 40, energy: 20, pawTokens: 275, adoptionDate: '2026-01-05T12:00:00.000Z', lastUpdatedAt: iso(T0 - 12 * H), hatchedAt: '2026-01-20T12:00:00.000Z' }),
  '@ProductivityPet:tasks': tasks,
  '@ProductivityPet:equippedPetHatId': 'hat-1',
  '@ProductivityPet:awardedTaskTokens': tasks.filter((t) => t.completed).map((t) => t.id),
  '@ProductivityPet:ownedShopItems': ['hat-1'],
};
fs.writeFileSync('tests/fixtures/legacy-single-pet.json', JSON.stringify(legacy, null, 2) + '\n');
