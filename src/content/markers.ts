/** Attribute marking every element the extension inserts into the page. */
export const INJECTED_ATTRIBUTE = 'data-menu-account-switcher';
export const INJECTED_SELECTOR = `[${INJECTED_ATTRIBUTE}]`;

/** Text content of an element, ignoring anything the extension inserted. */
export function nativeText(element: Element): string {
  if (element.querySelector(INJECTED_SELECTOR) === null) return element.textContent;
  const clone = element.cloneNode(true) as Element;
  for (const injected of clone.querySelectorAll(INJECTED_SELECTOR)) injected.remove();
  return clone.textContent;
}
