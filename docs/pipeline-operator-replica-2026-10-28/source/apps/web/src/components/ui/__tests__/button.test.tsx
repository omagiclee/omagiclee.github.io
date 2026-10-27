import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../button";

describe("Button", () => {
  it("forwards click events through the Base UI primitive", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>刷新</Button>);

    fireEvent.click(screen.getByRole("button", { name: "刷新" }));

    expect(onClick).toHaveBeenCalledOnce();
  });
});
