import { useReveal } from '../lib/useReveal';

/** Wraps a section's content in a subtle one-time fade + rise as it scrolls
 *  into view. Purely presentational — never delays or hides real data. */
function Reveal({ children, className = '', as: Tag = 'div' }) {
  const [ref, visible] = useReveal();
  return (
    <Tag ref={ref} className={`reveal ${visible ? 'reveal-visible' : ''} ${className}`}>
      {children}
    </Tag>
  );
}

export default Reveal;
