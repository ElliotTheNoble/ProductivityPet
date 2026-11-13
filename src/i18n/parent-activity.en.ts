// English strings for the Parent Dashboard's Tasks, Accomplishments and Activity History sections (read-only, from saved data only).
// English is the base language: every key must exist in parent-activity.es.ts (TypeScript checks this). Placeholders are written {name}.
export const parentActivityEn = {
  paUnavailable: "This couldn't be read right now. Nothing was changed.",
  paMore: '…and {count} more',


  paAssignedTitle: 'Tasks assigned by you',

  // accomplishments
  paMilestones: 'Pet milestones',
  paNoMilestones: 'No milestones yet.',
  paDays_one: '{count} day',
  paDays_other: '{count} days',
  paBest: 'Best: {value}',
  paReadError: "Couldn't read this.",
  paTokensNow: '{count} now',
  paTokensEarned: 'Earned: {count} since {date}',
  paTokensNone: 'None yet',
  paShopItems: 'Shop items',
  paActSince: 'Since {date}',
  paMsArrived: '{pet} arrived',
  paMsHatched: '{pet} hatched',
  paMsRecovered: '{pet} got better',
  paMsResurrected: '{pet} came back',
  paMsRetired: '{pet} moved to Pet Pawadise',
  paMsReturned: '{pet} came home again',
  paMsDied: '{pet} passed away',
  paStreak: 'Day streak',
  paTokens: 'Paw Tokens',

  // activity history
  paActTitle: 'Activity history',
  paActNote: 'Deleted tasks and un-checked completions are not included.',
  paActUndated_one: '{count} earlier completion has no saved date.',
  paActUndated_other: '{count} earlier completions have no saved date.',
  paPeriodDay: 'Day',
  paPeriodWeek: 'Week',
  paPeriodMonth: 'Month',
  paPeriodYear: 'Year',
  paWeekOf: 'Week of {date}',
  paRowTasks_one: '{count} task done',
  paRowTasks_other: '{count} tasks done',
  paRowNone: 'Nothing recorded',
  paRowTokens: '{count} Paw Tokens',
  paRowTokensPartial: '{count} Paw Tokens (tracking began during this period)',
  paRowTokensBefore: 'Paw Tokens: not tracked yet',
  paRowTokensNone: 'Paw Tokens: no history',
  paActNothing: 'Nothing recorded yet.',
  paRowHousehold_one: '{count} task approved',
  paRowHousehold_other: '{count} tasks approved',
  // opening the tasks from the overview
  paOpenTasks: "Open {name}'s tasks",
  paOpenPending: "Open {name}'s tasks waiting for your approval ({count})",
  paNeedsApproval: 'Needs approval ({count})',
};
