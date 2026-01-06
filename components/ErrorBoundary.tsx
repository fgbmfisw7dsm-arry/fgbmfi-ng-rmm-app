import React, { Component, ErrorInfo, ReactNode } from 'react';

// Define explicit interfaces for Props and State to resolve TypeScript property access issues
interface ErrorBoundaryProps {
  // children is made optional to allow flexible usage in the component tree
  children?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

/**
 * ErrorBoundary component that catches JavaScript errors anywhere in their child component tree,
 * logs those errors, and displays a fallback UI instead of the component tree that crashed.
 */
// Fix: Extending Component directly from react to ensure inherited members like 'props' and 'state' are correctly resolved by TypeScript
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  // Fix: Explicitly declare the props property to satisfy strict TypeScript checking on inherited members
  public props: ErrorBoundaryProps;

  // Fix: Explicitly declare the state property to satisfy strict TypeScript checking on inherited members
  public state: ErrorBoundaryState = {
    hasError: false,
    error: null
  };

  constructor(props: ErrorBoundaryProps) {
    super(props);
    // Fix: Explicitly assign props to ensure it's available for access in the render method and satisfies compiler checks
    this.props = props;
  }

  // Static method to update state when an error is caught during rendering
  static getDerivedStateFromError(error: any): ErrorBoundaryState {
    return { hasError: true, error };
  }

  // Lifecycle method for logging error details
  componentDidCatch(error: any, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    // Accessing state which is correctly typed in the class
    if (this.state.hasError) {
      return (
        <div className="p-8 text-center bg-red-50 text-red-800 min-h-screen flex flex-col items-center justify-center">
          <h2 className="text-2xl font-bold mb-4">Something went wrong.</h2>
          <p className="mb-4">The application encountered a critical error.</p>
          <pre className="bg-white p-4 rounded border text-xs text-left overflow-auto max-w-lg mb-4">
            {this.state.error?.toString()}
          </pre>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-red-600 text-white rounded-lg font-bold"
          >
            Reload Application
          </button>
        </div>
      );
    }

    // Fix: Accessing 'this.props' which is now correctly recognized as an inherited member from Component
    return this.props.children || null;
  }
}