import { Routes, Route } from 'react-router-dom'
import { Home, EventDetail } from './pages'
import './App.css'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/event/:eventId" element={<EventDetail />} />
    </Routes>
  )
}

export default App
