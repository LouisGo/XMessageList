import './app.css'
import { DemoMessageList } from './demo/DemoMessageList'
import { E2EMessageListApp } from './e2e-app/E2EMessageListApp'

function App() {
  if (window.location.pathname === '/e2e') {
    return <E2EMessageListApp />
  }

  return <DemoMessageList />
}

export default App
