// Bedtime rules use the device's LOCAL clock, so the tests run in one fixed
// time zone (one that has daylight saving) to be reproducible on any machine.
module.exports = async () => {
  process.env.TZ = 'America/Chicago';
};
