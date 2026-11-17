// `npm run demo`: Hearth in demo mode (HEARTH_DEMO=1) for recording a demo video. It keeps its
// data in a separate folder, runs its timers in minutes, saves each spoken reply as a WAV and logs
// the live signals. Your normal Hearth data is not touched.
import { spawn } from 'child_process'

const child = spawn('npx', ['electron-vite', 'dev'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, HEARTH_DEMO: '1' }
})
child.on('exit', (code) => process.exit(code ?? 0))
