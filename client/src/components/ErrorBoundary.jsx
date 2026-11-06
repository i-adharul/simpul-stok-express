import { Component } from 'react'
import { useLocation } from 'react-router'
import ServerError from '../views/ServerError'

// React only catches render errors in a class component. Errors in event handlers and requests
// are not caught here; the http interceptor handles the request errors (see utils/http.js).
class Boundary extends Component {
  state = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  // Moving to another route gives the app a fresh start; otherwise "Ke dashboard" would keep the 500 page.
  static getDerivedStateFromProps(props, state) {
    if (props.resetKey === state.resetKey) return null
    return { failed: false, resetKey: props.resetKey }
  }

  componentDidCatch(error) {
    console.error(error)
  }

  render() {
    return this.state.failed ? <ServerError /> : this.props.children
  }
}

export default function ErrorBoundary({ children }) {
  const { pathname } = useLocation()
  return <Boundary resetKey={pathname}>{children}</Boundary>
}
