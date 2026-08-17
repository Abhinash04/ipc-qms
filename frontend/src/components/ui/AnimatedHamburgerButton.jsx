import { MotionConfig, motion } from "framer-motion";

export const AnimatedHamburgerButton = ({ active, setActive, size = "sm", className = "" }) => {
  const isLg = size === "lg";
  return (
    <MotionConfig
      transition={{
        duration: 0.5,
        ease: "easeInOut",
      }}
    >
      <motion.button
        initial={false}
        animate={active ? "open" : "closed"}
        onClick={() => setActive((pv) => !pv)}
        aria-label={active ? "Close menu" : "Open menu"}
        aria-expanded={active}
        className={`relative rounded-full bg-transparent transition-colors hover:bg-cream-card dark:hover:bg-surface-dark-elevated flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isLg ? "h-20 w-20" : "h-10 w-10"
        } ${className}`}
      >
        <motion.span
          variants={isLg ? VARIANTS_LG.top : VARIANTS_SM.top}
          className={`absolute bg-ink dark:bg-on-dark ${isLg ? "h-1 w-10" : "h-0.5 w-5"}`}
          style={{ y: "-50%", left: "50%", x: "-50%", top: "35%" }}
        />
        <motion.span
          variants={isLg ? VARIANTS_LG.middle : VARIANTS_SM.middle}
          className={`absolute bg-ink dark:bg-on-dark ${isLg ? "h-1 w-10" : "h-0.5 w-5"}`}
          style={{ left: "50%", x: "-50%", top: "50%", y: "-50%" }}
        />
        <motion.span
          variants={isLg ? VARIANTS_LG.bottom : VARIANTS_SM.bottom}
          className={`absolute bg-ink dark:bg-on-dark ${isLg ? "h-1 w-5" : "h-0.5 w-2.5"}`}
          style={{
            x: "-50%",
            y: "50%",
            bottom: "35%",
            left: isLg ? "calc(50% + 10px)" : "calc(50% + 5px)",
          }}
        />
      </motion.button>
    </MotionConfig>
  );
};

const VARIANTS_LG = {
  top: {
    open: {
      rotate: ["0deg", "0deg", "45deg"],
      top: ["35%", "50%", "50%"],
    },
    closed: {
      rotate: ["45deg", "0deg", "0deg"],
      top: ["50%", "50%", "35%"],
    },
  },
  middle: {
    open: {
      rotate: ["0deg", "0deg", "-45deg"],
    },
    closed: {
      rotate: ["-45deg", "0deg", "0deg"],
    },
  },
  bottom: {
    open: {
      rotate: ["0deg", "0deg", "45deg"],
      bottom: ["35%", "50%", "50%"],
      left: "50%",
    },
    closed: {
      rotate: ["45deg", "0deg", "0deg"],
      bottom: ["50%", "50%", "35%"],
      left: "calc(50% + 10px)",
    },
  },
};

const VARIANTS_SM = {
  top: {
    open: {
      rotate: ["0deg", "0deg", "45deg"],
      top: ["35%", "50%", "50%"],
    },
    closed: {
      rotate: ["45deg", "0deg", "0deg"],
      top: ["50%", "50%", "35%"],
    },
  },
  middle: {
    open: {
      rotate: ["0deg", "0deg", "-45deg"],
    },
    closed: {
      rotate: ["-45deg", "0deg", "0deg"],
    },
  },
  bottom: {
    open: {
      rotate: ["0deg", "0deg", "45deg"],
      bottom: ["35%", "50%", "50%"],
      left: "50%",
    },
    closed: {
      rotate: ["45deg", "0deg", "0deg"],
      bottom: ["50%", "50%", "35%"],
      left: "calc(50% + 5px)",
    },
  },
};