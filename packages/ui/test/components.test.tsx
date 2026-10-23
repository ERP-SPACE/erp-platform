import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ColumnDef } from "@tanstack/react-table";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Money, NumberInput, Register, StatusMark } from "../src/index.js";

afterEach(cleanup);

describe("Money", () => {
  it("uses Indian grouping and parentheses for negatives", () => {
    render(<Money value="482300" />);
    expect(screen.getByText("₹ 4,82,300.00")).toBeTruthy();
    render(<Money value="-1200" />);
    expect(screen.getByText("(₹ 1,200.00)").className).toContain("text-critical");
  });
});

describe("StatusMark", () => {
  it("renders a word, not just a colour", () => {
    render(<StatusMark tone="caution">On hold</StatusMark>);
    expect(screen.getByText("On hold")).toBeTruthy();
  });
});

describe("NumberInput", () => {
  function Harness() {
    const [value, setValue] = useState("");
    return <NumberInput aria-label="Rate" value={value} onValueChange={setValue} decimals={2} />;
  }

  it("accepts decimals up to the limit and rejects letters or extra places", () => {
    render(<Harness />);
    const input = screen.getByLabelText("Rate") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "12.5" } });
    expect(input.value).toBe("12.5");
    fireEvent.change(input, { target: { value: "12.555" } });
    expect(input.value).toBe("12.5");
    fireEvent.change(input, { target: { value: "12a" } });
    expect(input.value).toBe("12.5");
    fireEvent.change(input, { target: { value: "1,250.75" } });
    expect(input.value).toBe("1250.75");
  });
});

describe("Register", () => {
  interface Row {
    id: string;
    name: string;
  }
  const columns: ColumnDef<Row, unknown>[] = [{ accessorKey: "name", header: "Party" }];
  const data: Row[] = [
    { id: "a", name: "Shree Prints" },
    { id: "b", name: "Arihant Tex" },
  ];

  it("moves with the arrow keys and opens with Enter", () => {
    const onOpen = vi.fn();
    render(
      <Register
        caption="Parties"
        data={data}
        columns={columns}
        getRowId={(r) => r.id}
        onSelect={() => {}}
        onOpen={onOpen}
      />,
    );
    const first = screen.getByText("Shree Prints").closest("tr")!;
    act(() => first.focus());
    fireEvent.keyDown(first, { key: "ArrowDown" });
    fireEvent.keyDown(screen.getByText("Arihant Tex").closest("tr")!, { key: "Enter" });
    expect(onOpen).toHaveBeenCalledWith(data[1]);
  });

  it("shows the empty state", () => {
    render(<Register caption="Parties" data={[]} columns={columns} getRowId={(r) => r.id} />);
    expect(screen.getByText("Nothing here yet.")).toBeTruthy();
  });
});
