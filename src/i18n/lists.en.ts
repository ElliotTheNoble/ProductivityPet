// Lists of strings (message pools, month and weekday names). A list key must exist in every language; each
// language's list can have a different length, so a message is picked by INDEX within the current language.
export const listsEn = {
  moodHappy: ['Today is a great day! 🌟', "I'm feeling pawsome! 🐾", "We're doing amazing! ✨", "I'm so happy today! 💕"],
  moodCalm: ['Nice and peaceful. 🌿', "Let's take our time today. 🕊️", 'Everything feels cozy. ☁️', 'One peaceful step at a time. 🌙'],
  moodFocused: ["We've got this! 💪", 'Time to get things done! ✅', "I'm in the zone! 🎯", "Let's tackle our next task! 📋"],
  moodStressed: [
    'One task at a time. 🌸',
    "We don't have to do everything at once. 💛",
    'A little break might help. 🍵',
    'We can handle this together. 🤝',
  ],
  moodTired: ['Maybe we need a little rest. 😴', 'I could use a cat nap... 💤', "Let's take it easy. 🌙", 'Rest is productive too! 🛌'],
  moodSick: [
    "Let's take it easy today. 🩹",
    'Time for some extra rest. 💊',
    'Take care of yourself today. 💗',
    'Tasks can wait. Health comes first! 🏥',
  ],
  completion: ['Yippee!', 'Yay!', 'Woohoo!', 'I knew you could do it!'],
  months: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  farewell: [
    'Thank you for taking such good care of me!',
    "I'm going to make so many new friends!",
    "Don't worry! I'll send you postcards!",
    "I'll miss our adventures together!",
    "This isn't goodbye forever! See you soon!",
    "I can't wait to tell you all about Pawadise!",
    "I'll write to you soon!",
  ],
  // one letter per day, Sunday first
  weekdaysNarrow: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
};
