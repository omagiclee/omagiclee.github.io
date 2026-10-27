import type { Meta, StoryObj } from "@storybook/react-vite";
import { Plus, RefreshCw } from "lucide-react";
import { Button } from "./button";

const meta = {
  title: "UI/Button",
  component: Button,
  tags: ["autodocs"],
  args: { children: "刷新数据" },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Filled: Story = {};

export const Elevated: Story = {
  args: { variant: "elevated" },
};

export const Tonal: Story = {
  args: { variant: "secondary" },
};

export const Outlined: Story = {
  args: { variant: "outline" },
};

export const Text: Story = {
  args: { variant: "ghost" },
};

export const WithLeadingIcon: Story = {
  args: { children: <><Plus />写入事件</> },
};

export const Icon: Story = {
  args: {
    children: <RefreshCw />,
    size: "icon",
    variant: "ghost",
    "aria-label": "刷新数据",
  },
};

export const Disabled: Story = {
  args: { children: <><RefreshCw />刷新数据</> },
  parameters: { controls: { disable: true } },
  render: (args) => <Button {...args} disabled />,
};
