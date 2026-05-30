import './demo/styles/index.css'
import { DemoMessageList } from './demo/components/DemoMessageList'
import { E2EMessageListApp } from './e2e-app/app/E2EMessageListApp'

function App() {
  if (window.location.pathname === '/e2e') {
    return <E2EMessageListApp />
  }

  return <DemoMessageList />
}

export default App
