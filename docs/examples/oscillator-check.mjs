// Local numerical illustration only: no Workbench API, files, accounts or HPC.
// q(t) = cos(omega*t) solves q'' + omega^2*q = 0 analytically.
// A centered finite difference checks the expected O(h^2) truncation behavior.
const omega = 1;
const t = 0.7;
const errors = [0.1, 0.05, 0.025].map(h => {
  const q = x => Math.cos(omega * x);
  const residual = (q(t + h) - 2 * q(t) + q(t - h)) / (h * h) + omega ** 2 * q(t);
  return { h, residual, absoluteError: Math.abs(residual) };
});
const ratios = errors.slice(1).map((entry, index) => errors[index].absoluteError / entry.absoluteError);
const passed = ratios.every(ratio => ratio > 3.9 && ratio < 4.1);
console.log(JSON.stringify({
  example: 'harmonic-oscillator finite-difference check',
  assumptions: 'Dimensionless omega=1, t=0.7; analytic q(t)=cos(omega*t).',
  errors, ratios, passed,
  limitation: 'Local numerical illustration at one time point; not DFT+DMFT validation or a recorded Research Run.',
}, null, 2));
if (!passed) process.exitCode = 1;
