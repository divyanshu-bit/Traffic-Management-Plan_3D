/**
 * Splits text into individual characters wrapped in spans for GSAP animation.
 * @param {string} text 
 * @returns {JSX.Element[]}
 */
export const splitText = (text) => {
  return text.split('').map((char, i) => (
    <span key={i} className="char" style={{ display: 'inline-block', whiteSpace: char === ' ' ? 'pre' : 'normal' }}>
      {char}
    </span>
  ));
};
