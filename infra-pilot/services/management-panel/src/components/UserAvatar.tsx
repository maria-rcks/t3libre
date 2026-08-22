import { useEffect, useRef } from "react";
import { update } from "jdenticon";

interface UserAvatarProps {
  value: string;
  size?: number;
  className?: string;
}

export const UserAvatar = ({ value, size = 36, className }: UserAvatarProps) => {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (ref.current) {
      update(ref.current, value);
    }
  }, [value]);

  return (
    <svg
      ref={ref}
      width={size}
      height={size}
      className={className}
      data-jdenticon-value={value}
    />
  );
};
