import './app.css'
import { DemoMessageViewport } from './demo/DemoMessageViewport'
import { E2EMessageViewportApp } from './e2e-app/E2EMessageViewportApp'

function App() {
  if (window.location.pathname === '/e2e') {
    return <E2EMessageViewportApp />
  }

  return <DemoMessageViewport />
}

export default App
