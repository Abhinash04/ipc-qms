export function getTimeBasedGreeting(name) {
  const firstName = name ? name.split(" ")[0] : "User";
  const hour = new Date().getHours();

  if (hour >= 4 && hour < 12) {
    return `Good Morning, ${firstName} 👋`;
  } else if (hour >= 12 && hour < 17) {
    return `Good Afternoon, ${firstName} ☀️ 👋`;
  } else {
    return `Good Evening, ${firstName} 🌙 👋`;
  }
}
