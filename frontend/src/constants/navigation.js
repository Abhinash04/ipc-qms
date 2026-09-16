import { SECTIONS, SECTION_ORDER } from './routeSections';
import { sectionsForRole } from './permissions';
import { sectionPath } from './routePaths';

const navSections = SECTION_ORDER.filter((section) => SECTIONS[section].nav);

export function navItemsForRole(role) {
  const granted = new Set(sectionsForRole(role));
  return navSections
    .filter((section) => granted.has(section))
    .map((section) => ({
      section,
      label: SECTIONS[section].label,
      icon: SECTIONS[section].icon,
      path: sectionPath(role, section),
    }));
}
