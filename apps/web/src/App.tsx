import { BrowserRouter } from 'react-router-dom';
import { AppRouter, useApiClient } from './app/router';

export function App() {
  const api = useApiClient();
  return (
    <BrowserRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <AppRouter api={api} />
    </BrowserRouter>
  );
}
