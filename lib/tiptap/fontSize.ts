import { Extension } from "@tiptap/core";

export const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (el) => el.style.fontSize || null,
            renderHTML: (attrs) =>
              attrs.fontSize ? { style: `font-size: ${attrs.fontSize}` } : {},
          },
          fontFamily: {
            default: null,
            parseHTML: (el) => el.style.fontFamily || null,
            renderHTML: (attrs) =>
              attrs.fontFamily
                ? { style: `font-family: ${attrs.fontFamily}` }
                : {},
          },
          color: {
            default: null,
            parseHTML: (el) => el.style.color || null,
            renderHTML: (attrs) =>
              attrs.color ? { style: `color: ${attrs.color}` } : {},
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }) => {
          return chain().setMark("textStyle", { fontSize: size }).run();
        },
      setFontFamily:
        (font: string) =>
        ({ chain }) => {
          return chain().setMark("textStyle", { fontFamily: font }).run();
        },
      setTextColor:
        (color: string) =>
        ({ chain }) => {
          return chain().setMark("textStyle", { color: color }).run();
        },
    };
  },
});

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fontSize: {
      /**
       * Set the font size
       */
      setFontSize: (size: string) => ReturnType;
      /**
       * Set the font family
       */
      setFontFamily: (font: string) => ReturnType;
      /**
       * Set the text color
       */
      setTextColor: (color: string) => ReturnType;
    };
  }
}
