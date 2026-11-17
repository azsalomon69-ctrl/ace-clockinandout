const wakeUrl = 'https://ace-clockinandout.onrender.com/v1/auth/config';

const weekdays = [1, 2, 3, 4, 5];
const overnightShiftDays = [2, 3, 4, 5, 6];
const weekend = [0, 6];

export function shouldWakeRender(scheduledTime) {
  // Manila stays at UTC+8. Shift the instant before checking its weekday.
  const manila = new Date(scheduledTime + 8 * 60 * 60 * 1000);
  const day = manila.getUTCDay();
  const time = manila.getUTCHours() * 100 + manila.getUTCMinutes();

  return time >= 2330 || time <= 40
    || weekdays.includes(day) && ((time >= 1400 && time <= 1520) || (time >= 1550 && time <= 1710))
    || overnightShiftDays.includes(day) && ((time >= 130 && time <= 210) || (time >= 630 && time <= 710))
    || weekend.includes(day) && time >= 2020 && time <= 2110;
}

export default {
  async scheduled(controller) {
    if (!shouldWakeRender(controller.scheduledTime)) return;
    const details = { scheduledAt: new Date(controller.scheduledTime).toISOString() };
    try {
      const response = await fetch(wakeUrl, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(75_000)
      });
      await response.body?.cancel();
      console.log('Render wake request completed', {
        ...details,
        status: response.status,
        renderRouting: response.headers.get('x-render-routing')
      });
    } catch (error) {
      console.warn('Render wake request did not return a response', {
        ...details, error: error.message
      });
    }
  }
};
