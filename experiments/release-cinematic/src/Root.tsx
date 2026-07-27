import React from "react";
import { Composition } from "remotion";
import { ReleaseCinematic, TOTAL_FRAMES } from "./ReleaseCinematic";

export const Root: React.FC = () => {
  return (
    <Composition
      id="ReleaseCinematic"
      component={ReleaseCinematic}
      durationInFrames={TOTAL_FRAMES}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};
