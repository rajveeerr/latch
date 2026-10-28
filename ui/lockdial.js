// The lock device: a putty-coloured body with a brushed-metal panel, a small LCD, a blue knurled knob and an orange lamp,
// with a bolt that slides in its slot. Typing shows dots on the LCD and turns the knob a notch per character; a wrong
// guess snaps the knob back and shows WRONG; a right one slides the bolt open. All CSS: no images, no canvas.

export function mountDial(box) {
  const lcd = box.querySelector('#lcdText'), dots = box.querySelector('#lcdDots');
  let timer = 0;
  const status = (text, ms) => { lcd.textContent = text; clearTimeout(timer); if (ms) timer = setTimeout(() => { lcd.textContent = box.classList.contains('open') ? 'OPEN' : 'LOCKED'; }, ms); };

  return {
    // one notch of the knob (25 degrees) for every character typed; the LCD shows one dot each, up to 12
    turn(length) {
      box.style.setProperty('--turn', `${(length * 25).toFixed(1)}deg`);
      dots.textContent = '•'.repeat(Math.min(length, 12));
      box.classList.toggle('typing', length > 0);
    },
    wrong() {
      box.classList.remove('wrong'); void box.offsetWidth; box.classList.add('wrong');
      box.style.setProperty('--turn', '0deg'); dots.textContent = ''; box.classList.remove('typing');
      status('WRONG', 1600);
    },
    open() { box.classList.add('open'); dots.textContent = ''; status('OPEN'); },
    calm() { box.classList.remove('wrong'); },
  };
}
