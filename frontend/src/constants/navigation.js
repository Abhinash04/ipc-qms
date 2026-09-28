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
      group: SECTIONS[section].group || 'workflow',
      path: sectionPath(role, section),
    }));
}

export const NAV_GROUP_ORDER = ['home', 'workflow', 'insights', 'admin'];

/** Nav items bucketed by their sidebar group heading, in display order. */
export function navGroupsForRole(role) {
  const items = navItemsForRole(role);
  return NAV_GROUP_ORDER.map((group) => ({
    group,
    items: items.filter((item) => item.group === group),
  })).filter((entry) => entry.items.length > 0);
}
