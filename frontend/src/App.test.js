import { render, screen } from '@testing-library/react';
import App from './App';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = function() {};
});

test('renders header title', () => {
  render(<App />);
  const title = screen.getByText(/Instalily Case Study - PartSelect Assistant/i);
  expect(title).toBeInTheDocument();
});


test('renders greeting message', () => {
  render(<App />);
  expect(screen.getByText(/Hi! I'm your PartSelect assistant/i)).toBeInTheDocument();
});
