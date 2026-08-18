import { SECTIONS, SECTION_ORDER } from './routeSections';
import { sectionsForRole } from './permissions';
import { sectionPath } from './routePaths';

const navSections = SECTION_ORDER.filter((section) => SECTIONS[section].nav);

export function navItemsForRole(role) {
  const granted = sectionsForRole(role);
  return navSections
    .filter((section) => granted.includes(section))
    .map((section) => ({
      section,
      label: SECTIONS[section].label,
      icon: SECTIONS[section].icon,
      path: sectionPath(role, section),
    }));
}
