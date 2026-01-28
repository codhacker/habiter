import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)


// const firebaseConfig = {
//     apiKey: "AIzaSyBp7mDobIYrVIUkDfuClqqfdm9JIYW3yvs",
//     authDomain: "gate26-mocks.firebaseapp.com",
//     projectId: "gate26-mocks",
//     storageBucket: "gate26-mocks.firebasestorage.app",
//     messagingSenderId: "46444663512",
//     appId: "1:46444663512:web:701e86ce9f47735ae1fdad",
//     measurementId: "G-2JZTZYTEWJ"
// };
