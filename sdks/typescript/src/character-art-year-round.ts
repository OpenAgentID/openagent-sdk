import type { CharacterArtFamily } from './character-art-types.js';

/** Original package-owned year-round bodies. Eyes are supplied only by the shared renderer. */
export const yearRoundArt: Readonly<Record<string, CharacterArtFamily>> = {
  "fold": {
    "label": "Fold",
    "color": "#FFD6AF",
    "shapes": {
      "standard": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "fold-paper-__INSTANCE__",
                    "x1": "79",
                    "y1": "46",
                    "x2": "236",
                    "y2": "355",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#FFD6AF"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#F4B687"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#D98165"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "fold-edge-__INSTANCE__",
                    "x1": "213",
                    "y1": "67",
                    "x2": "246",
                    "y2": "267",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#C87362"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#8B5365"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M76 58 134 30 228 42 260 103 235 209 243 265 207 352 150 373 76 339 63 260 91 198 67 135Z",
                    "fill": "url(#fold-paper-__INSTANCE__)",
                    "stroke": "#B77763",
                    "stroke-width": "1.5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M76 58 134 30 228 42 237 70 95 65Z",
                    "fill": "#FFE5C7"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M76 58 95 65 89 174 91 198 67 135Z",
                    "fill": "#DB9272"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M237 70 260 103 235 209 220 218 228 179Z",
                    "fill": "url(#fold-edge-__INSTANCE__)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M91 198 113 222 137 256 63 260Z",
                    "fill": "#FFE0BC"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M113 222 220 218 243 265 137 256Z",
                    "fill": "#F5BF91"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M137 256 243 265 207 352 150 373 156 305Z",
                    "fill": "#C87868"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M137 256 156 305 150 373 76 339 63 260Z",
                    "fill": "#EBA17E"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M156 305 207 352 150 373Z",
                    "fill": "#454C6A"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M63 260 137 256 156 305",
                    "fill": "none",
                    "stroke": "#FFE3C4",
                    "stroke-width": "2"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M237 70 228 179",
                    "fill": "none",
                    "stroke": "#FFE2C1",
                    "stroke-width": "2"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M76 339 150 373 207 352",
                    "fill": "none",
                    "stroke": "#A96760",
                    "stroke-width": "1.2"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 55.0,
          "y": 20.0,
          "size": 210
        }
      },
      "kite": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "fold-kite-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#C87868"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#AE6358"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#D98165"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M130 32 228 58 258 121 231 187 201 215 179 291 160 374 135 307 98 215 67 170 77 101 102 52Z",
                    "fill": "url(#fold-kite-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M130 32 228 58 232 72 97 73 102 52Z",
                    "fill": "#FFE5C7"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M77 101 97 73 89 182 67 170Z",
                    "fill": "#EBA17E"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M232 72 258 121 231 187 223 173Z",
                    "fill": "#8B5365"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M98 215 201 215 179 291 156 312Z",
                    "fill": "#FFD6AF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M98 215 156 312 135 307Z",
                    "fill": "#F4B687"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M156 312 179 291 160 374 148 331Z",
                    "fill": "#454C6A"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M135 285 88 301 109 318 143 306M175 313 222 328 201 341 170 329",
                    "fill": "#D98165"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M97 73 232 72M98 215 156 312 179 291",
                    "fill": "none",
                    "stroke": "#FFE3C4",
                    "stroke-width": "2"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "fan": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "fold-fan-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#B46B5A"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#A85F53"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#D98165"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M97 53 223 49 244 81 237 191 269 244 260 339 221 365 186 348 160 375 132 348 95 366 61 340 51 245 83 202 77 96Z",
                    "fill": "url(#fold-fan-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M97 53 223 49 244 81 224 74 95 75 77 96Z",
                    "fill": "#FFD6AF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M83 202 106 214 132 348 95 366 61 340 51 245Z",
                    "fill": "#FFE0BC"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M106 214 139 226 160 375 132 348Z",
                    "fill": "#D98165"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M139 226 160 213 181 226 160 375Z",
                    "fill": "#FFD6AF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M181 226 215 213 221 365 186 348 160 375Z",
                    "fill": "#C87868"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M215 213 237 191 269 244 260 339 221 365Z",
                    "fill": "#8B5365"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M64 259 95 341 106 214M139 226 160 375M215 213 246 337",
                    "fill": "none",
                    "stroke": "#F5BF91",
                    "stroke-width": "2"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M132 348 160 375 186 348 181 341 160 359 139 341Z",
                    "fill": "#454C6A"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      }
    }
  },
  "sprig": {
    "label": "Sprig",
    "color": "#154C3D",
    "shapes": {
      "standard": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "sprig-__INSTANCE__-pod",
                    "x1": "100",
                    "y1": "60",
                    "x2": "213",
                    "y2": "365",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#236B4D"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.48",
                        "stop-color": "#154C3D"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#388F5B"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "sprig-__INSTANCE__-leaf",
                    "x1": "100",
                    "y1": "27",
                    "x2": "172",
                    "y2": "80",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#C6DCA0"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.42",
                        "stop-color": "#72B66A"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#388F5B"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "sprig-__INSTANCE__-fold",
                    "x1": "104",
                    "y1": "183",
                    "x2": "169",
                    "y2": "365",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#72B66A",
                        "stop-opacity": "0.6"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#C6DCA0",
                        "stop-opacity": "0.13"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {},
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M157 76C122 74 94 53 84 27C121 26 152 46 157 76Z",
                    "fill": "url(#sprig-__INSTANCE__-leaf)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M154 76C151 47 177 24 213 28C207 57 186 76 154 76Z",
                    "fill": "url(#sprig-__INSTANCE__-leaf)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M155 75C128 57 111 41 91 32M158 74C171 53 185 40 205 32",
                    "fill": "none",
                    "stroke": "#154C3D",
                    "stroke-opacity": "0.35",
                    "stroke-width": "3",
                    "stroke-linecap": "round"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M159 60C218 55 252 84 256 130C262 193 247 271 221 324C207 349 185 366 159 377C132 365 111 345 97 320C71 270 63 194 72 131C78 86 109 57 159 60Z",
                    "fill": "url(#sprig-__INSTANCE__-pod)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M88 183C83 246 108 314 155 366C132 350 108 323 98 292C87 257 85 219 88 183Z",
                    "fill": "url(#sprig-__INSTANCE__-fold)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M231 190C223 256 204 318 164 361",
                    "fill": "none",
                    "stroke": "#C6DCA0",
                    "stroke-opacity": "0.23",
                    "stroke-width": "2.5",
                    "stroke-linecap": "round"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M90 113C93 89 108 75 124 71",
                    "fill": "none",
                    "stroke": "#72B66A",
                    "stroke-opacity": "0.65",
                    "stroke-width": "5",
                    "stroke-linecap": "round"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 45.0,
          "y": 10.0,
          "size": 230
        }
      },
      "bud": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "sprig-bud-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#236B4D"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#154C3D"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#388F5B"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M157 54C152 39 164 27 182 29C194 30 196 40 190 46C180 35 168 40 169 55",
                    "fill": "none",
                    "stroke": "#72B66A",
                    "stroke-width": "9"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M156 49C209 41 251 73 253 119C257 158 239 190 221 213C244 247 239 291 213 321C196 342 177 359 157 376C136 358 110 340 92 311C72 278 76 240 96 212C76 192 65 162 68 126C70 80 105 53 156 49Z",
                    "fill": "url(#sprig-bud-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M96 212C79 229 81 259 98 282C92 255 108 235 126 224C114 224 101 219 96 212Z",
                    "fill": "#72B66A"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M221 213C236 230 238 253 225 278C220 253 204 231 187 224C202 222 215 219 221 213Z",
                    "fill": "#388F5B"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M100 275C111 312 137 351 157 376C160 337 155 308 143 287C128 284 110 281 100 275Z",
                    "fill": "#72B66A",
                    "opacity": "0.5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M225 278C216 319 188 354 157 376C186 329 195 303 194 284Z",
                    "fill": "#C6DCA0",
                    "opacity": "0.25"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M86 99C91 80 103 68 121 63M236 105C238 127 231 145 225 157",
                    "fill": "none",
                    "stroke": "#72B66A",
                    "stroke-width": "3",
                    "opacity": "0.65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M126 224C131 244 144 266 157 277M187 224C184 243 170 266 157 277",
                    "fill": "none",
                    "stroke": "#C6DCA0",
                    "stroke-width": "2",
                    "opacity": "0.45"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "leaf": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "sprig-leaf-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#236B4D"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#154C3D"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#388F5B"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M151 294C144 323 152 354 167 375",
                    "fill": "none",
                    "stroke": "#72B66A",
                    "stroke-width": "12"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M158 348C137 327 107 327 94 340C113 357 137 364 158 348Z",
                    "fill": "#388F5B"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M161 358C175 334 204 328 229 339C214 361 191 373 161 358Z",
                    "fill": "#72B66A"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M147 35C204 30 251 59 261 108C274 168 245 225 204 273C184 297 166 320 156 341C133 309 98 281 77 241C46 181 54 115 87 73C104 51 125 40 147 35Z",
                    "fill": "url(#sprig-leaf-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M77 241C102 267 130 284 153 291L156 341C133 309 98 281 77 241Z",
                    "fill": "#72B66A",
                    "opacity": "0.5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M232 182C217 225 187 266 156 305M80 187C101 230 129 258 155 273M102 233 158 253M217 226 158 253",
                    "fill": "none",
                    "stroke": "#C6DCA0",
                    "stroke-width": "2.5",
                    "opacity": "0.36"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M83 109C91 81 109 63 129 54",
                    "fill": "none",
                    "stroke": "#72B66A",
                    "stroke-width": "5",
                    "opacity": "0.7"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M182 49C212 57 235 77 245 99",
                    "fill": "none",
                    "stroke": "#C6DCA0",
                    "stroke-width": "2",
                    "opacity": "0.35"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      }
    }
  },
  "ripple": {
    "label": "Ripple",
    "color": "#084F68",
    "shapes": {
      "standard": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "ripple-__INSTANCE__-water",
                    "x1": "95",
                    "y1": "47",
                    "x2": "225",
                    "y2": "363",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#096B80"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.38",
                        "stop-color": "#084F68"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.72",
                        "stop-color": "#138BA0"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#096B80"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "ripple-__INSTANCE__-rim",
                    "x1": "245",
                    "y1": "82",
                    "x2": "184",
                    "y2": "337",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#BCF4EE"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#58D4D9"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#58D4D9",
                        "stop-opacity": "0.16"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "ripple-__INSTANCE__-current",
                    "x1": "83",
                    "y1": "218",
                    "x2": "210",
                    "y2": "351",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#58D4D9",
                        "stop-opacity": "0.4"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#BCF4EE",
                        "stop-opacity": "0.1"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {},
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M147 48C107 42 79 65 76 109C73 154 54 182 49 219C43 260 75 299 116 321C154 341 162 377 203 371C244 365 260 334 239 307C223 285 193 269 201 237C208 207 269 200 277 155C282 106 248 59 207 51C182 46 166 51 147 48Z",
                    "fill": "url(#ripple-__INSTANCE__-water)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M236 76C263 105 269 139 258 163C245 192 204 194 188 228C175 258 187 281 207 298",
                    "fill": "none",
                    "stroke": "url(#ripple-__INSTANCE__-rim)",
                    "stroke-width": "8",
                    "stroke-linecap": "round"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M72 226C69 257 100 283 127 300C157 319 169 352 201 354C178 364 163 342 144 326C112 298 70 278 64 246C63 237 66 229 72 226Z",
                    "fill": "url(#ripple-__INSTANCE__-current)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M100 72C87 90 86 112 88 136",
                    "fill": "none",
                    "stroke": "#BCF4EE",
                    "stroke-opacity": "0.55",
                    "stroke-width": "4",
                    "stroke-linecap": "round"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1.02
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "drop": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "ripple-drop-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#096B80"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#084F68"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#138BA0"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M160 29C181 58 227 58 249 94C270 128 261 168 249 203C239 231 238 266 221 300C207 331 186 355 160 376C133 355 109 328 94 301C73 262 64 215 65 171C65 119 89 82 125 59C140 49 151 41 160 29Z",
                    "fill": "url(#ripple-drop-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M232 88C252 113 257 145 248 172C239 196 236 223 232 246",
                    "fill": "none",
                    "stroke": "#58D4D9",
                    "stroke-width": "7",
                    "opacity": "0.65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M83 99C76 120 76 145 81 162",
                    "fill": "none",
                    "stroke": "#BCF4EE",
                    "stroke-width": "4",
                    "opacity": "0.55"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M91 228C98 290 127 326 160 354C145 326 130 300 126 267C115 250 102 237 91 228Z",
                    "fill": "#58D4D9",
                    "opacity": "0.24"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M223 278C211 311 190 342 169 361",
                    "fill": "none",
                    "stroke": "#BCF4EE",
                    "stroke-width": "2",
                    "opacity": "0.45"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "wave": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "ripple-wave-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#096B80"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#084F68"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#138BA0"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M92 67C122 42 173 48 196 37C230 24 252 35 264 57C233 49 220 63 221 79C258 92 277 122 266 154C276 180 263 204 239 219C219 232 205 248 213 269C229 292 263 300 260 328C257 360 222 377 188 369C156 364 136 340 111 329C69 310 48 284 49 246C50 216 66 193 73 170C57 139 63 91 92 67Z",
                    "fill": "url(#ripple-wave-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M229 86C254 98 269 122 260 145C249 174 210 187 199 217C187 247 198 271 220 286",
                    "fill": "none",
                    "stroke": "#58D4D9",
                    "stroke-width": "8",
                    "opacity": "0.75"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M75 234C70 267 94 289 126 304C155 318 167 347 196 350C166 346 151 325 136 316C101 297 67 289 63 264C61 251 64 240 75 234Z",
                    "fill": "#BCF4EE",
                    "opacity": "0.24"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M224 318C235 325 235 338 223 344",
                    "fill": "none",
                    "stroke": "#BCF4EE",
                    "stroke-width": "3",
                    "opacity": "0.55"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M88 104C92 87 105 76 119 71",
                    "fill": "none",
                    "stroke": "#BCF4EE",
                    "stroke-width": "3",
                    "opacity": "0.5"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      }
    }
  },
  "halo": {
    "label": "Halo",
    "color": "#302B67",
    "shapes": {
      "standard": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "halo-__INSTANCE__-shell",
                    "x1": "117",
                    "y1": "56",
                    "x2": "196",
                    "y2": "363",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#44397D"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.42",
                        "stop-color": "#302B67"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.75",
                        "stop-color": "#68579D"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#A293CA"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "halo-__INSTANCE__-orbit",
                    "x1": "46",
                    "y1": "174",
                    "x2": "275",
                    "y2": "80",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#A293CA"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.28",
                        "stop-color": "#F5D79A"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.7",
                        "stop-color": "#F5D79A"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#68579D"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "halo-__INSTANCE__-trail",
                    "x1": "220",
                    "y1": "232",
                    "x2": "146",
                    "y2": "377",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#A293CA",
                        "stop-opacity": "0.55"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#F5D79A",
                        "stop-opacity": "0.12"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {},
              "children": [
                {
                  "tag": "ellipse",
                  "attributes": {
                    "cx": "160",
                    "cy": "126",
                    "rx": "121",
                    "ry": "66",
                    "transform": "rotate(-12 160 126)",
                    "fill": "none",
                    "stroke": "url(#halo-__INSTANCE__-orbit)",
                    "stroke-opacity": "0.65",
                    "stroke-width": "7"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M157 54C209 49 242 82 245 123C249 167 228 197 196 211C208 231 231 241 232 270C234 301 194 317 168 347C153 363 150 373 140 378C142 348 140 329 117 304C91 277 91 250 109 226C118 214 126 210 128 202C93 189 74 162 75 125C75 84 107 58 157 54Z",
                    "fill": "url(#halo-__INSTANCE__-shell)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M195 226C202 246 214 256 210 272C206 294 166 316 151 351C151 324 176 299 189 280C200 265 186 244 195 226Z",
                    "fill": "url(#halo-__INSTANCE__-trail)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M93 115C96 88 112 71 134 66",
                    "fill": "none",
                    "stroke": "#A293CA",
                    "stroke-opacity": "0.44",
                    "stroke-width": "4",
                    "stroke-linecap": "round"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M42 151C58 188 117 207 180 190C229 179 269 142 278 101",
                    "fill": "none",
                    "stroke": "url(#halo-__INSTANCE__-orbit)",
                    "stroke-width": "7",
                    "stroke-linecap": "round"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 49.0,
          "y": 14.0,
          "size": 222
        }
      },
      "comet": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "halo-comet-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#44397D"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#302B67"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#68579D"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M146 43C189 34 230 52 244 84C264 128 247 173 218 197C230 231 264 260 275 302L249 293C262 326 261 346 252 370C231 341 212 327 195 318C195 341 179 366 157 378C164 344 141 331 123 314C100 291 112 247 101 218C81 201 65 173 66 137C65 89 98 54 146 43Z",
                    "fill": "url(#halo-comet-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M218 211C230 241 253 268 261 289C230 272 207 244 196 222Z",
                    "fill": "#F5D79A"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M188 246C203 275 221 294 249 320L252 370C232 340 216 327 195 318C190 292 182 268 188 246Z",
                    "fill": "#A293CA"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M139 236C131 262 137 287 160 307C174 323 181 341 157 378C159 344 141 331 123 314C110 291 117 257 119 240Z",
                    "fill": "#68579D"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M83 108C89 81 106 64 129 59",
                    "fill": "none",
                    "stroke": "#A293CA",
                    "stroke-width": "4",
                    "opacity": "0.65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M218 68C229 79 235 91 239 103",
                    "fill": "none",
                    "stroke": "#F5D79A",
                    "stroke-width": "2.5",
                    "opacity": "0.6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M217 276 235 290M205 293 227 313",
                    "fill": "none",
                    "stroke": "#F5D79A",
                    "stroke-width": "2",
                    "opacity": "0.65"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "satellite": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "halo-satellite-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#44397D"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#302B67"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#68579D"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M109 214 57 200 43 256 90 284 119 256Z",
                    "fill": "#68579D",
                    "stroke": "#F5D79A",
                    "stroke-width": "3"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M211 214 263 200 277 256 230 284 201 256Z",
                    "fill": "#68579D",
                    "stroke": "#F5D79A",
                    "stroke-width": "3"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M63 215 54 251 90 271 105 250M257 215 266 251 230 271 215 250M72 218 66 259M91 223 81 267M248 218 254 259M229 223 239 267",
                    "fill": "none",
                    "stroke": "#A293CA",
                    "stroke-width": "2"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M120 191 199 191 216 255 193 313 166 375 135 320 104 256Z",
                    "fill": "url(#halo-satellite-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M139 291 165 304 193 288 166 375Z",
                    "fill": "#F5D79A"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M131 225 188 225 195 266 163 290 123 263Z",
                    "fill": "#A293CA",
                    "opacity": "0.45"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M108 40 213 40 244 70 245 163 220 195 101 195 75 164 77 72Z",
                    "fill": "url(#halo-satellite-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M108 40 213 40 244 70 219 74 102 73 77 72Z",
                    "fill": "#A293CA"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M245 80 245 163 220 195 226 181 230 83Z",
                    "fill": "#F5D79A",
                    "opacity": "0.62"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M160 41V28M146 29H174",
                    "fill": "none",
                    "stroke": "#F5D79A",
                    "stroke-width": "5"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      }
    }
  },
  "purl": {
    "label": "Purl",
    "color": "#2C8068",
    "shapes": {
      "standard": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "purl-yarn-__INSTANCE__",
                    "x1": "92",
                    "y1": "40",
                    "x2": "223",
                    "y2": "365",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#2C8068"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#287469"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#225A55"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M103 40C133 25 176 27 202 37C232 33 253 55 252 82C260 111 245 144 229 165C250 183 273 193 277 218C279 242 263 257 245 260C249 289 240 313 224 329C212 344 215 368 194 376C174 379 167 362 161 349C151 370 134 379 116 371C100 363 105 341 99 330C83 321 75 303 75 282C54 283 42 269 43 247C47 224 66 207 87 193C81 177 76 161 71 146C61 118 61 93 74 72C77 56 89 48 103 40Z",
                    "fill": "url(#purl-yarn-__INSTANCE__)",
                    "stroke": "#1E5A51",
                    "stroke-width": "1.5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M77 90C73 109 80 135 87 150M86 84C81 107 86 130 92 145M239 89C243 110 235 135 228 147",
                    "fill": "none",
                    "stroke": "#6BC5A6",
                    "stroke-width": "3",
                    "opacity": "0.65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M56 244C57 257 63 266 75 268M61 232C58 247 65 257 77 260M254 209C263 218 263 231 254 240M247 214C253 223 253 232 245 239",
                    "fill": "none",
                    "stroke": "#1D5F55",
                    "stroke-width": "2",
                    "opacity": "0.7"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M112 349C121 354 130 356 139 352M116 358C124 363 131 363 137 359M178 349C188 354 198 350 204 344M180 358C188 364 197 357 201 352",
                    "fill": "none",
                    "stroke": "#163F3E",
                    "stroke-width": "2"
                  }
                },
                {
                  "tag": "g",
                  "attributes": {
                    "fill": "none",
                    "stroke": "#1D514C",
                    "stroke-width": "2",
                    "opacity": "0.72"
                  },
                  "children": [
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M102 211C102 220 109 225 111 228C113 225 120 220 120 211"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M134 211C134 220 141 225 143 228C145 225 152 220 152 211"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M166 211C166 220 173 225 175 228C177 225 184 220 184 211"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M198 211C198 220 205 225 207 228C209 225 216 220 216 211"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M105 239C105 248 112 253 114 256C116 253 123 248 123 239"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M137 239C137 248 144 253 146 256C148 253 155 248 155 239"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M169 239C169 248 176 253 178 256C180 253 187 248 187 239"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M201 239C201 248 208 253 210 256C212 253 219 248 219 239"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M102 267C102 276 109 281 111 284C113 281 120 276 120 267"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M134 267C134 276 141 281 143 284C145 281 152 276 152 267"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M166 267C166 276 173 281 175 284C177 281 184 276 184 267"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M198 267C198 276 205 281 207 284C209 281 216 276 216 267"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M105 295C105 304 112 309 114 312C116 309 123 304 123 295"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M137 295C137 304 144 309 146 312C148 309 155 304 155 295"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M169 295C169 304 176 309 178 312C180 309 187 304 187 295"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M201 295C201 304 208 309 210 312C212 309 219 304 219 295"
                      }
                    }
                  ]
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M106 198C129 192 160 196 187 202",
                    "fill": "none",
                    "stroke": "#65B99E",
                    "stroke-width": "3",
                    "opacity": "0.55"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 55.0,
          "y": 20.0,
          "size": 210
        }
      },
      "mitt": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "purl-mitt-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#2C8068"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#287469"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#225A55"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M88 65C101 36 142 27 183 32C218 31 242 51 244 86C246 117 234 145 237 170C250 159 268 173 275 194C279 213 271 235 253 246L233 260C235 283 226 304 216 320L216 350C216 367 206 374 190 374H126C108 374 99 366 99 350L101 320C82 298 75 272 79 249L82 193C71 165 68 129 73 98C75 85 80 73 88 65Z",
                    "fill": "url(#purl-mitt-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M101 319C135 308 182 308 216 320V350C216 367 206 374 190 374H126C108 374 99 366 99 350Z",
                    "fill": "#1D514C"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M111 327V359M127 323V365M143 322V366M159 322V366M175 322V366M191 325V364M205 330V358",
                    "fill": "none",
                    "stroke": "#65B99E",
                    "stroke-width": "4",
                    "opacity": "0.65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M247 182C259 184 267 199 263 214C260 226 254 231 246 235",
                    "fill": "none",
                    "stroke": "#6BC5A6",
                    "stroke-width": "3",
                    "opacity": "0.6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M87 96C84 117 88 143 94 156M229 86C235 103 233 122 227 138",
                    "fill": "none",
                    "stroke": "#65B99E",
                    "stroke-width": "3",
                    "opacity": "0.7"
                  }
                },
                {
                  "tag": "g",
                  "attributes": {
                    "fill": "none",
                    "stroke": "#1D514C",
                    "stroke-width": "2",
                    "opacity": "0.8"
                  },
                  "children": [
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M103 219C103 227 109 232 111 235C113 232 119 227 119 219"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M135 219C135 227 141 232 143 235C145 232 151 227 151 219"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M167 219C167 227 173 232 175 235C177 232 183 227 183 219"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M199 219C199 227 205 232 207 235C209 232 215 227 215 219"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M103 248C103 256 109 261 111 264C113 261 119 256 119 248"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M135 248C135 256 141 261 143 264C145 261 151 256 151 248"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M167 248C167 256 173 261 175 264C177 261 183 256 183 248"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M199 248C199 256 205 261 207 264C209 261 215 256 215 248"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M103 277C103 285 109 290 111 293C113 290 119 285 119 277"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M135 277C135 285 141 290 143 293C145 290 151 285 151 277"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M167 277C167 285 173 290 175 293C177 290 183 285 183 277"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M199 277C199 285 205 290 207 293C209 290 215 285 215 277"
                      }
                    }
                  ]
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "hood": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "purl-hood-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#2C8068"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#287469"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#225A55"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M161 28C129 36 93 47 79 76C64 108 68 152 87 178L97 194C71 211 50 238 47 265C45 283 57 297 75 291L98 268L84 339C79 358 95 376 113 374H213C230 375 244 357 237 339L224 268L246 292C265 297 277 283 273 264C270 238 248 210 222 194L233 175C253 142 253 103 240 77C227 49 192 35 161 28Z",
                    "fill": "url(#purl-hood-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M161 36C129 44 100 51 87 78C78 97 80 126 87 148M235 78C245 105 241 134 231 154",
                    "fill": "none",
                    "stroke": "#6BC5A6",
                    "stroke-width": "5",
                    "opacity": "0.55"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M101 198C120 205 140 214 161 216C181 214 201 206 220 198",
                    "fill": "none",
                    "stroke": "#1D514C",
                    "stroke-width": "9"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M126 215 128 268M195 215 192 269",
                    "fill": "none",
                    "stroke": "#65B99E",
                    "stroke-width": "4"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M121 265 134 265 134 278 123 278Z M186 266 198 266 197 279 186 278Z",
                    "fill": "#1D514C"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M92 336C132 343 190 343 230 336L237 353C194 365 130 365 84 354Z",
                    "fill": "#1D514C"
                  }
                },
                {
                  "tag": "g",
                  "attributes": {
                    "fill": "none",
                    "stroke": "#1D514C",
                    "stroke-width": "2",
                    "opacity": "0.75"
                  },
                  "children": [
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M103 284C103 292 109 297 111 300C113 297 119 292 119 284"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M135 284C135 292 141 297 143 300C145 297 151 292 151 284"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M167 284C167 292 173 297 175 300C177 297 183 292 183 284"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M199 284C199 292 205 297 207 300C209 297 215 292 215 284"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M103 310C103 318 109 323 111 326C113 323 119 318 119 310"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M135 310C135 318 141 323 143 326C145 323 151 318 151 310"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M167 310C167 318 173 323 175 326C177 323 183 318 183 310"
                      }
                    },
                    {
                      "tag": "path",
                      "attributes": {
                        "d": "M199 310C199 318 205 323 207 326C209 323 215 318 215 310"
                      }
                    }
                  ]
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M59 258 76 275M245 273 262 255",
                    "fill": "none",
                    "stroke": "#65B99E",
                    "stroke-width": "3"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      }
    }
  },
  "prism": {
    "label": "Prism",
    "color": "#303A69",
    "shapes": {
      "standard": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "prism-__INSTANCE__-front",
                    "x1": "94",
                    "y1": "72",
                    "x2": "226",
                    "y2": "185",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#515B94"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#303A69"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "prism-__INSTANCE__-body",
                    "x1": "103",
                    "y1": "209",
                    "x2": "201",
                    "y2": "345",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#7981DF"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#424F9B"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "prism-__INSTANCE__-edge",
                    "x1": "225",
                    "y1": "63",
                    "x2": "239",
                    "y2": "191",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#CAB6EF"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#93DCC4"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M122 333L146 334L143 365L122 377L104 374L110 364Z",
                    "fill": "#303A69"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M175 335L199 332L210 364L224 372L216 378L181 373Z",
                    "fill": "#424F9B"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M112 363L140 359L143 365L122 377L104 374Z",
                    "fill": "#93DCC4"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M185 359L208 360L224 372L216 378L181 373Z",
                    "fill": "#CAB6EF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M99 217L81 236L71 278L50 291L46 282L58 266L65 228L83 201Z",
                    "fill": "#626BD6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M221 207L245 230L253 272L273 284L267 295L243 280L229 244L213 227Z",
                    "fill": "#515B94"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M51 274L72 272L80 287L65 304L45 296L40 284Z",
                    "fill": "#CAB6EF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M249 271L270 273L280 287L269 301L249 293L242 279Z",
                    "fill": "#93DCC4"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M111 202L209 202L222 249L199 345L120 345L97 249Z",
                    "fill": "url(#prism-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M111 202L139 218L132 302L120 345L97 249Z",
                    "fill": "#CAB6EF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M209 202L187 219L183 303L199 345L222 249Z",
                    "fill": "#303A69",
                    "opacity": ".65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M139 218L187 219L183 303L157 323L132 302Z",
                    "fill": "#6F7BCE"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M123 186L193 186L209 210L160 223L111 208Z",
                    "fill": "#93DCC4"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M160 28L253 74L253 158L220 204L98 201L65 132L91 60Z",
                    "fill": "#626BD6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M160 28L219 72L101 72L91 60Z",
                    "fill": "#CAB6EF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M160 28L253 74L219 72Z",
                    "fill": "#9398EB"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M91 60L101 72L93 181L65 132Z",
                    "fill": "#919CE0"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M219 72L253 74L253 158L228 181Z",
                    "fill": "url(#prism-__INSTANCE__-edge)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M101 72H219L228 181H93Z",
                    "fill": "url(#prism-__INSTANCE__-front)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M93 181H228L220 204L98 201Z",
                    "fill": "#465287"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M101 72H219",
                    "fill": "none",
                    "stroke": "#E5DDF8",
                    "stroke-width": "2",
                    "opacity": ".6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M253 76V157L230 182",
                    "fill": "none",
                    "stroke": "#C8F3E7",
                    "stroke-width": "2",
                    "opacity": ".6"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 55.0,
          "y": 20.0,
          "size": 210
        }
      },
      "crystal": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "prism-crystal-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#515B94"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#303A69"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#424F9B"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M108 238 73 213 47 244 60 319 120 343Z",
                    "fill": "#626BD6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M73 213 69 271 60 319 47 244Z",
                    "fill": "#CAB6EF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M211 237 251 215 274 250 258 328 198 347Z",
                    "fill": "#626BD6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M251 215 244 279 258 328 274 250Z",
                    "fill": "#93DCC4"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M160 29 235 60 244 165 208 215 188 353 147 377 115 343 103 211 77 168 87 65Z",
                    "fill": "url(#prism-crystal-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M160 29 235 60 221 72 98 72 87 65Z",
                    "fill": "#CAB6EF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M87 65 98 72 91 184 77 168Z",
                    "fill": "#9398EB"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M221 72 235 60 244 165 230 184Z",
                    "fill": "#93DCC4"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M103 211 145 236 147 377 115 343Z",
                    "fill": "#626BD6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M145 236 183 231 188 353 147 377Z",
                    "fill": "#7981DF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M183 231 208 215 188 353Z",
                    "fill": "#303A69"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M98 72H221M145 236 147 377",
                    "fill": "none",
                    "stroke": "#E5DDF8",
                    "stroke-width": "2",
                    "opacity": "0.65"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "obelisk": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "prism-obelisk-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#515B94"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#303A69"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#424F9B"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M160 28 229 61 238 183 203 211 215 345 249 363 242 376 74 376 67 363 103 345 117 211 82 183 91 61Z",
                    "fill": "url(#prism-obelisk-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M160 28 229 61 218 73 103 73 91 61Z",
                    "fill": "#CAB6EF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M91 61 103 73 99 181 82 183Z",
                    "fill": "#626BD6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M218 73 229 61 238 183 227 181Z",
                    "fill": "#93DCC4"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M117 211 144 219 137 341 103 345Z",
                    "fill": "#CAB6EF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M144 219 178 219 183 341 137 341Z",
                    "fill": "#626BD6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M178 219 203 211 215 345 183 341Z",
                    "fill": "#303A69"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M103 345 137 341 183 341 215 345 249 363 67 363Z",
                    "fill": "#7981DF"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M67 363 249 363 242 376 74 376Z",
                    "fill": "#303A69"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M105 354H213M103 73H218",
                    "fill": "none",
                    "stroke": "#93DCC4",
                    "stroke-width": "2",
                    "opacity": "0.65"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      }
    }
  },
  "coil": {
    "label": "Coil",
    "color": "#38535B",
    "shapes": {
      "standard": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "coil-__INSTANCE__-ceramic",
                    "x1": "105",
                    "y1": "46",
                    "x2": "217",
                    "y2": "185",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#567C82"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": ".65",
                        "stop-color": "#38535B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#2D434E"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "coil-__INSTANCE__-copper",
                    "x1": "89",
                    "y1": "218",
                    "x2": "226",
                    "y2": "339",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#FAD5A3"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": ".34",
                        "stop-color": "#F5B86F"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": ".7",
                        "stop-color": "#D88E65"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#B86653"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "coil-__INSTANCE__-spine",
                    "x1": "146",
                    "y1": "199",
                    "x2": "175",
                    "y2": "199",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#B3C8C4"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": ".5",
                        "stop-color": "#6D8A8D"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#38535B"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M113 346C120 336 199 334 211 346L231 362C237 373 219 379 160 379C105 379 83 373 89 363Z",
                    "fill": "#38535B"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M101 357C126 347 192 347 219 357",
                    "fill": "none",
                    "stroke": "#73A5A5",
                    "stroke-width": "7"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M147 189H174V354H147Z",
                    "fill": "url(#coil-__INSTANCE__-spine)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M147 217H174M147 251H174M147 285H174M147 319H174",
                    "fill": "none",
                    "stroke": "#314A52",
                    "stroke-width": "3"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M110 211C86 218 87 230 128 238C171 246 231 250 230 268C229 287 101 282 91 302C81 322 192 327 212 340",
                    "fill": "none",
                    "stroke": "#8D574D",
                    "stroke-width": "15"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M208 208C235 218 232 230 193 239C152 249 92 254 91 271C90 289 218 288 230 307C241 326 128 332 110 345",
                    "fill": "none",
                    "stroke": "url(#coil-__INSTANCE__-copper)",
                    "stroke-width": "17"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M208 204C231 214 227 223 191 232M103 265C103 274 157 278 197 281M218 307C220 316 161 322 121 337",
                    "fill": "none",
                    "stroke": "#FFE1B1",
                    "stroke-width": "3",
                    "opacity": ".75"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M103 225L76 242L69 269",
                    "fill": "none",
                    "stroke": "#73A5A5",
                    "stroke-width": "12"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M218 245L248 258L253 282",
                    "fill": "none",
                    "stroke": "#73A5A5",
                    "stroke-width": "12"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M60 262C49 266 44 281 55 288C66 295 82 284 80 273C78 264 69 259 60 262Z",
                    "fill": "#F5B86F"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M253 275C267 274 278 285 274 295C270 307 254 306 247 298C240 290 243 278 253 275Z",
                    "fill": "#F5B86F"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M128 180H191L204 205C187 219 130 218 113 205Z",
                    "fill": "#73A5A5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M83 112C77 72 105 45 150 41C202 33 237 57 244 99C254 146 234 181 182 191C128 202 81 178 83 112Z",
                    "fill": "url(#coil-__INSTANCE__-ceramic)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M94 84C101 60 122 49 150 47C179 44 201 48 218 60",
                    "fill": "none",
                    "stroke": "#A2D0C8",
                    "stroke-width": "3",
                    "opacity": ".75"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M84 118C80 157 112 189 152 190",
                    "fill": "none",
                    "stroke": "#27434C",
                    "stroke-width": "5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M144 41C140 34 145 27 157 26C168 25 176 30 176 37",
                    "fill": "none",
                    "stroke": "#F5B86F",
                    "stroke-width": "9"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 55.0,
          "y": 20.0,
          "size": 210
        }
      },
      "spring": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "coil-spring-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#567C82"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#38535B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#2D434E"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M146 187H175V357H146Z",
                    "fill": "#6D8A8D"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M96 347H225L247 367C251 375 221 379 162 379C106 379 78 375 81 367Z",
                    "fill": "#38535B"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M95 360C129 351 194 351 232 361",
                    "fill": "none",
                    "stroke": "#73A5A5",
                    "stroke-width": "6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M98 214C67 218 70 237 106 243C157 253 242 252 246 269C251 286 69 281 76 301C80 317 234 321 234 339",
                    "fill": "none",
                    "stroke": "#8D574D",
                    "stroke-width": "16"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M217 207C252 216 252 233 214 241C164 252 78 252 75 271C72 289 248 286 245 307C242 322 118 334 91 345",
                    "fill": "none",
                    "stroke": "#F5B86F",
                    "stroke-width": "18"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M220 207C242 215 242 222 222 227M84 268C93 279 173 276 218 285M233 306C225 316 151 322 110 337",
                    "fill": "none",
                    "stroke": "#FFE1B1",
                    "stroke-width": "3",
                    "opacity": "0.75"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M104 44H216C233 44 242 57 242 74L244 151C244 177 229 192 207 192H105C83 192 77 177 78 151L78 78C77 57 87 44 104 44Z",
                    "fill": "url(#coil-spring-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M102 51H216M87 76V104",
                    "fill": "none",
                    "stroke": "#A2D0C8",
                    "stroke-width": "3",
                    "opacity": "0.7"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M92 185C125 196 194 197 226 184",
                    "fill": "none",
                    "stroke": "#27434C",
                    "stroke-width": "5"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "bellows": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "coil-bellows-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#567C82"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#38535B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#2D434E"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M89 202H232L251 217 231 235 249 253 230 271 249 289 230 307 248 327 229 345H94L73 327 93 307 73 289 91 271 73 253 92 235 73 217Z",
                    "fill": "#B86653"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M89 202H232L251 217H73Z M92 235H231L249 253H73Z M91 271H230L249 289H73Z M93 307H230L248 327H73Z",
                    "fill": "#F5B86F"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M73 217H251M73 253H249M73 289H249M73 327H248",
                    "fill": "none",
                    "stroke": "#FFE1B1",
                    "stroke-width": "3",
                    "opacity": "0.6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M110 225H211M109 263H212M110 299H211M111 337H212",
                    "fill": "none",
                    "stroke": "#8D574D",
                    "stroke-width": "4"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M89 345H232L243 364Q241 377 220 377H102Q80 377 79 364Z",
                    "fill": "#38535B"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M107 43C136 32 188 33 216 46C245 59 256 88 249 130L241 163C234 184 217 198 187 200H128C98 198 79 179 73 153L68 112C63 80 80 53 107 43Z",
                    "fill": "url(#coil-bellows-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M85 84C94 60 119 48 148 46M192 47C213 51 229 63 236 78",
                    "fill": "none",
                    "stroke": "#A2D0C8",
                    "stroke-width": "3",
                    "opacity": "0.7"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M103 192H217",
                    "fill": "none",
                    "stroke": "#73A5A5",
                    "stroke-width": "6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M99 359H224",
                    "fill": "none",
                    "stroke": "#73A5A5",
                    "stroke-width": "5"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      }
    }
  },
  "kiln": {
    "label": "Kiln",
    "color": "#AD6045",
    "shapes": {
      "standard": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "kiln-clay-__INSTANCE__",
                    "x1": "102",
                    "y1": "43",
                    "x2": "236",
                    "y2": "356",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#AD6045"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.48",
                        "stop-color": "#9C553F"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#814331"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "kiln-glaze-__INSTANCE__",
                    "x1": "96",
                    "y1": "220",
                    "x2": "237",
                    "y2": "340",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#AE7187"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#884969"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#683C59"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M104 42C124 29 156 30 175 38C188 34 206 35 221 42C244 51 254 72 251 101L245 149C242 168 228 184 214 198C229 218 253 230 265 253C278 278 275 310 248 330C253 349 247 369 231 375C213 379 195 368 184 351C168 359 148 360 131 351C119 366 105 379 86 373C70 367 65 350 77 334C57 321 49 292 57 270C65 247 87 224 104 205C95 190 88 174 85 152L81 103C78 76 85 54 104 42Z",
                    "fill": "url(#kiln-clay-__INSTANCE__)",
                    "stroke": "#793E32",
                    "stroke-width": "1.5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M76 236C98 216 115 217 132 220C150 223 153 201 171 209C186 216 187 236 204 228C226 218 252 236 265 253C278 278 275 310 248 330C232 342 218 346 201 346C170 362 138 354 119 349C91 345 69 324 60 300C54 281 61 254 76 236Z",
                    "fill": "url(#kiln-glaze-__INSTANCE__)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M76 236C98 216 115 217 132 220C150 223 153 201 171 209C186 216 187 236 204 228C226 218 245 230 256 241",
                    "fill": "none",
                    "stroke": "#C892A3",
                    "stroke-width": "2.5",
                    "opacity": "0.75"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M77 265C69 287 76 310 93 323",
                    "fill": "none",
                    "stroke": "#E4B7BC",
                    "stroke-width": "5",
                    "opacity": "0.52"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M85 265C80 282 84 298 93 307",
                    "fill": "none",
                    "stroke": "#D6A4B3",
                    "stroke-width": "2",
                    "opacity": "0.52"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M252 265C263 288 253 308 242 316",
                    "fill": "none",
                    "stroke": "#532F4B",
                    "stroke-width": "3",
                    "opacity": "0.5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M94 68C99 57 112 48 124 47",
                    "fill": "none",
                    "stroke": "#FFE2C5",
                    "stroke-width": "4",
                    "opacity": "0.65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M87 357C97 367 111 365 119 358M211 358C220 367 233 366 237 354",
                    "fill": "none",
                    "stroke": "#8D4F3E",
                    "stroke-width": "2",
                    "opacity": "0.55"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 55.0,
          "y": 20.0,
          "size": 210
        }
      },
      "vase": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "kiln-vase-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#AD6045"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#9C553F"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#814331"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M76 47C124 31 196 31 244 47L236 89C230 129 230 159 240 193C255 225 275 250 273 283C271 315 243 340 220 350L217 372H102L101 349C76 338 48 313 46 283C44 251 65 224 79 193C89 159 89 129 84 89Z",
                    "fill": "url(#kiln-vase-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M76 47C126 57 196 57 244 47L238 65C186 75 134 75 81 65Z",
                    "fill": "#D99170"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M66 225C96 218 113 238 140 237C162 233 167 218 185 223C203 231 232 222 256 234C269 252 275 275 270 294C260 324 237 340 220 350C180 365 136 365 101 349C78 338 54 315 48 291C45 268 52 246 66 225Z",
                    "fill": "#884969"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M66 225C96 218 113 238 140 237C162 233 167 218 185 223C203 231 232 222 256 234",
                    "fill": "none",
                    "stroke": "#AE7187",
                    "stroke-width": "3"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M68 259C62 290 77 317 99 330",
                    "fill": "none",
                    "stroke": "#E4B7BC",
                    "stroke-width": "5",
                    "opacity": "0.5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M92 91C96 111 96 141 92 159",
                    "fill": "none",
                    "stroke": "#D99170",
                    "stroke-width": "3",
                    "opacity": "0.6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M102 357H217M102 369H217",
                    "fill": "none",
                    "stroke": "#793E32",
                    "stroke-width": "3"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "teapot": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "kiln-teapot-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#AD6045"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#9C553F"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#814331"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M230 180C267 175 277 208 267 231C260 251 247 259 230 254",
                    "fill": "none",
                    "stroke": "#884969",
                    "stroke-width": "14"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M233 184C259 183 266 206 259 224",
                    "fill": "none",
                    "stroke": "#AE7187",
                    "stroke-width": "3",
                    "opacity": "0.7"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M89 198C69 207 61 196 55 175L45 177C46 215 48 239 71 250L94 268Z",
                    "fill": "#9C553F"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M88 224C71 229 60 214 57 203",
                    "fill": "none",
                    "stroke": "#D99170",
                    "stroke-width": "3"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M111 70C135 62 187 62 208 69C230 76 240 96 239 128L235 192C256 218 261 247 253 278C244 315 212 333 183 337H136C105 335 79 318 69 286C57 251 66 218 89 192L85 128C82 101 88 78 111 70Z",
                    "fill": "url(#kiln-teapot-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M109 69C111 52 127 44 148 42L150 29H173L176 43C196 45 212 54 213 70Z",
                    "fill": "#D99170"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M104 72C133 78 191 78 220 71",
                    "fill": "none",
                    "stroke": "#793E32",
                    "stroke-width": "4"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M83 215C111 205 129 221 158 223C188 228 218 210 244 220C258 243 259 267 250 288C235 318 209 331 183 337H136C107 334 83 319 72 291C65 264 68 236 83 215Z",
                    "fill": "#884969"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M82 247C77 270 87 292 104 303",
                    "fill": "none",
                    "stroke": "#E4B7BC",
                    "stroke-width": "5",
                    "opacity": "0.5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M123 337H199L210 359C186 370 136 370 111 359Z",
                    "fill": "#814331"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M121 357C143 364 178 364 201 357",
                    "fill": "none",
                    "stroke": "#D99170",
                    "stroke-width": "3"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      }
    }
  },
  "wisp": {
    "label": "Wisp",
    "color": "#9E332B",
    "shapes": {
      "standard": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "wisp-__INSTANCE__-ember",
                    "x1": "153",
                    "y1": "28",
                    "x2": "173",
                    "y2": "373",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#F7BD75"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.23",
                        "stop-color": "#BE432C"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.54",
                        "stop-color": "#9E332B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.8",
                        "stop-color": "#DC642F"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#F1934D"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "wisp-__INSTANCE__-ribbon",
                    "x1": "92",
                    "y1": "204",
                    "x2": "192",
                    "y2": "352",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#F7BD75",
                        "stop-opacity": "0.8"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.54",
                        "stop-color": "#F1934D",
                        "stop-opacity": "0.45"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#F7BD75",
                        "stop-opacity": "0.12"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {},
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M182 27C185 59 225 63 242 95C264 136 245 176 225 207C208 234 238 252 251 281C271 326 229 356 181 367C154 374 125 373 103 366C128 350 141 329 135 311C128 291 103 294 84 278C64 261 65 236 75 211C87 182 72 157 73 128C74 96 89 74 112 68C141 60 152 48 160 37C168 27 175 25 182 27Z",
                    "fill": "url(#wisp-__INSTANCE__-ember)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M95 207C84 234 88 251 108 264C130 278 148 291 151 312C155 333 141 350 126 359C153 350 172 328 165 305C159 282 131 269 113 253C101 242 98 225 104 211Z",
                    "fill": "url(#wisp-__INSTANCE__-ribbon)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M220 204C206 229 218 249 238 269",
                    "fill": "none",
                    "stroke": "#F7BD75",
                    "stroke-opacity": "0.38",
                    "stroke-width": "3",
                    "stroke-linecap": "round"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M96 101C99 86 108 78 119 75",
                    "fill": "none",
                    "stroke": "#F7BD75",
                    "stroke-opacity": "0.5",
                    "stroke-width": "4",
                    "stroke-linecap": "round"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "flame": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "wisp-flame-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#BE432C"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#9E332B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#DC642F"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M159 28C168 63 191 55 208 42C204 64 246 77 254 118C266 153 245 183 244 207C242 232 267 249 270 281C273 318 248 345 214 362C186 376 139 379 108 367C77 355 50 327 48 295C46 261 62 236 72 210C86 176 65 153 70 119C75 84 101 71 117 57C136 49 151 47 159 28Z",
                    "fill": "url(#wisp-flame-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M119 59C143 56 159 47 163 40C175 66 186 70 202 65C185 76 171 87 149 76C137 70 126 67 119 59Z",
                    "fill": "#F7BD75",
                    "opacity": "0.7"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M69 274C69 310 88 337 113 349C132 361 153 363 176 363C142 342 134 316 131 289C127 263 102 246 89 230C79 250 70 260 69 274Z",
                    "fill": "#F1934D",
                    "opacity": "0.55"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M98 277C100 306 114 330 133 340",
                    "fill": "none",
                    "stroke": "#F7BD75",
                    "stroke-width": "4",
                    "opacity": "0.6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M237 225C245 248 258 261 255 285C252 305 238 324 218 332",
                    "fill": "none",
                    "stroke": "#F7BD75",
                    "stroke-width": "3",
                    "opacity": "0.45"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M83 102C88 87 101 78 111 75",
                    "fill": "none",
                    "stroke": "#F7BD75",
                    "stroke-width": "3",
                    "opacity": "0.5"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "curl": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "wisp-curl-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#BE432C"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#9E332B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#DC642F"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M122 45C161 31 209 39 231 68C257 103 259 151 235 183C221 202 192 216 195 234C201 250 234 249 253 268C280 294 276 332 249 355C218 380 171 375 143 350C124 333 121 307 133 289C145 270 172 269 185 284C198 298 193 314 182 323C170 332 157 324 157 314C157 305 166 301 171 306C172 295 160 291 151 301C139 315 151 339 173 347C197 358 225 347 237 327C249 305 235 282 211 274C181 264 146 268 120 252C95 238 92 214 97 193C73 177 66 150 68 120C72 83 88 56 122 45Z",
                    "fill": "url(#wisp-curl-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M109 217C104 237 121 249 145 253C169 258 199 254 218 269",
                    "fill": "none",
                    "stroke": "#F7BD75",
                    "stroke-width": "5",
                    "opacity": "0.6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M246 291C257 319 237 348 215 357M143 309C143 331 161 344 179 348",
                    "fill": "none",
                    "stroke": "#F1934D",
                    "stroke-width": "4",
                    "opacity": "0.6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M83 103C88 80 105 61 125 55",
                    "fill": "none",
                    "stroke": "#F7BD75",
                    "stroke-width": "3",
                    "opacity": "0.55"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M226 78C235 90 240 106 240 121",
                    "fill": "none",
                    "stroke": "#F1934D",
                    "stroke-width": "2.5",
                    "opacity": "0.5"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      }
    }
  },
  "relay": {
    "label": "Relay",
    "color": "#D9E2D8",
    "shapes": {
      "standard": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "relay-__INSTANCE__-enamel",
                    "x1": "87",
                    "y1": "49",
                    "x2": "226",
                    "y2": "326",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#F2F3DF"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": ".55",
                        "stop-color": "#D9E2D8"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#A9BDB4"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "relay-__INSTANCE__-face",
                    "x1": "102",
                    "y1": "77",
                    "x2": "218",
                    "y2": "177",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#48616B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#304A56"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "relay-__INSTANCE__-wood",
                    "x1": "75",
                    "y1": "70",
                    "x2": "103",
                    "y2": "272",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#BA8260"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#694334"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linejoin": "round",
                "stroke-linecap": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M119 319L149 323L143 357L111 374L90 367L102 349Z",
                    "fill": "#304A56"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M177 323L205 318L220 351L234 367L213 376L183 361Z",
                    "fill": "#304A56"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M104 350L140 347L143 357L111 374L90 367Z",
                    "fill": "#EF9866"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M183 349L219 351L234 367L213 376L183 361Z",
                    "fill": "#EF9866"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M88 201L60 209L45 237L48 261L62 264L64 244L80 231L104 228Z",
                    "fill": "#8C5B49"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M223 214L251 200L270 211L278 242L266 250L258 224L237 234Z",
                    "fill": "#8C5B49"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M45 246L66 245L77 263L66 281L43 274L36 260Z",
                    "fill": "#D9E2D8"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M262 235L279 238L284 258L273 271L255 260Z",
                    "fill": "#EF9866"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M110 38C144 25 198 29 221 49L247 79L243 169L224 199L218 288C217 317 196 339 163 338C127 339 101 324 96 297L91 200L72 168L75 83C78 59 89 46 110 38Z",
                    "fill": "url(#relay-__INSTANCE__-enamel)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M75 83L93 67L97 191L111 211L117 310C104 303 101 289 99 270L91 200L72 168Z",
                    "fill": "url(#relay-__INSTANCE__-wood)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M228 67L247 79L243 169L224 199L218 288C217 303 211 313 202 321L207 204L227 181Z",
                    "fill": "#8C5B49"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M112 69H209C217 69 225 77 225 86V176C225 185 218 190 209 190H111C102 190 96 183 96 175V85C96 76 103 69 112 69Z",
                    "fill": "#EF9866"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M114 75H207C214 75 219 79 219 86V174C219 180 214 184 207 184H114C107 184 102 179 102 173V86C102 79 107 75 114 75Z",
                    "fill": "url(#relay-__INSTANCE__-face)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M114 75H207",
                    "fill": "none",
                    "stroke": "#B6CDD0",
                    "stroke-width": "2",
                    "opacity": ".65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M119 219L190 219L197 290L180 308H139L121 292Z",
                    "fill": "#C3D0C6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M135 242H176M136 253H178M137 264H180",
                    "fill": "none",
                    "stroke": "#6F8985",
                    "stroke-width": "5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M136 289L143 297H176L182 290",
                    "fill": "none",
                    "stroke": "#EF9866",
                    "stroke-width": "4"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M84 95L86 164M234 94L231 162",
                    "fill": "none",
                    "stroke": "#D7A685",
                    "stroke-width": "2",
                    "opacity": ".7"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M108 39L125 29H195L213 42",
                    "fill": "none",
                    "stroke": "#EF9866",
                    "stroke-width": "8"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 55.0,
          "y": 20.0,
          "size": 210
        }
      },
      "radio": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "relay-radio-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#48616B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#304A56"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#304A56"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M112 60V44Q112 31 126 31H197Q212 31 212 45V60",
                    "fill": "none",
                    "stroke": "#8C5B49",
                    "stroke-width": "9"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M231 73 250 29",
                    "fill": "none",
                    "stroke": "#304A56",
                    "stroke-width": "5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M86 60H234Q257 60 260 83L267 313Q268 343 242 351H78Q53 343 55 316L60 84Q62 60 86 60Z",
                    "fill": "#D9E2D8"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M60 84 78 66 84 344 78 351Q53 343 55 316Z",
                    "fill": "#8C5B49"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M242 67 260 83 267 313Q268 343 242 351L236 344Z",
                    "fill": "#694334"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M93 74H226V190H93Z",
                    "fill": "#EF9866"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M99 79H220V184H99Z",
                    "fill": "url(#relay-radio-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M94 212H224V308H94Z",
                    "fill": "#A9BDB4"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M108 228H211M108 245H211M108 262H211M108 279H211M108 296H211",
                    "fill": "none",
                    "stroke": "#6F8985",
                    "stroke-width": "6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M174 326H220",
                    "fill": "none",
                    "stroke": "#EF9866",
                    "stroke-width": "8"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M87 351H120L114 375H79Z M202 351H235L243 375H208Z",
                    "fill": "#304A56"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M99 79H220",
                    "fill": "none",
                    "stroke": "#B6CDD0",
                    "stroke-width": "2",
                    "opacity": "0.6"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "beacon": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "relay-beacon-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#48616B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#304A56"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#304A56"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M139 184H183L197 326 232 348 235 376H86L90 349 124 326Z",
                    "fill": "#D9E2D8"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M139 220 112 253 129 279 104 314 124 326 152 288 132 259 156 232Z",
                    "fill": "#8C5B49"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M183 220 210 253 193 279 218 314 197 326 170 288 190 259 167 232Z",
                    "fill": "#8C5B49"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M145 248H178L182 321H138Z",
                    "fill": "#A9BDB4"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M90 349H232L235 376H86Z",
                    "fill": "#304A56"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M77 62 105 38 146 29 177 29 217 39 245 62 232 78H90Z",
                    "fill": "#EF9866"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M93 65H230L235 184 215 204H107L87 184Z",
                    "fill": "#D9E2D8"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M99 75H222L225 178 212 190H109L96 178Z",
                    "fill": "url(#relay-beacon-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M91 82 89 180 104 197M231 82 233 180 218 197",
                    "fill": "none",
                    "stroke": "#8C5B49",
                    "stroke-width": "6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M102 356H220M122 50H201",
                    "fill": "none",
                    "stroke": "#D9E2D8",
                    "stroke-width": "3",
                    "opacity": "0.6"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      }
    }
  },
  "cairn": {
    "label": "Cairn",
    "color": "#283A44",
    "shapes": {
      "standard": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "cairn-__INSTANCE__-head",
                    "x1": "111",
                    "y1": "49",
                    "x2": "220",
                    "y2": "186",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#57717B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": ".62",
                        "stop-color": "#425B68"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#283A44"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "cairn-__INSTANCE__-upper",
                    "x1": "111",
                    "y1": "191",
                    "x2": "208",
                    "y2": "247",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#95AAA6"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#627F80"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "cairn-__INSTANCE__-middle",
                    "x1": "128",
                    "y1": "237",
                    "x2": "195",
                    "y2": "314",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#68828B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#3D5763"
                      }
                    }
                  ]
                },
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "cairn-__INSTANCE__-lower",
                    "x1": "105",
                    "y1": "304",
                    "x2": "210",
                    "y2": "357",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#77999D"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#4E6D73"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M103 349C90 354 83 365 92 374C104 379 135 377 145 367C152 357 131 344 103 349Z",
                    "fill": "#425B68"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M188 348C209 342 230 349 235 363C238 376 215 383 196 374C181 368 176 357 188 348Z",
                    "fill": "#425B68"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M94 367C108 373 127 371 136 365M197 368C209 374 223 372 229 365",
                    "fill": "none",
                    "stroke": "#C2B69A",
                    "stroke-width": "2",
                    "opacity": ".65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M92 215C67 209 43 222 45 244C48 262 69 267 85 252C98 241 107 222 92 215Z",
                    "fill": "#627F80"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M230 222C252 214 275 225 275 245C273 261 255 267 240 256C225 247 214 232 230 222Z",
                    "fill": "#77999D"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M52 246C43 243 36 253 39 267C42 283 58 290 70 280C83 268 76 248 63 245Z",
                    "fill": "#C2B69A"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M256 250C269 245 284 253 283 267C282 282 266 287 255 277C246 269 244 255 256 250Z",
                    "fill": "#C2B69A"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M104 302C118 290 181 293 212 306C236 316 240 338 218 350C191 367 127 365 99 348C80 337 82 320 104 302Z",
                    "fill": "url(#cairn-__INSTANCE__-lower)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M117 234C140 222 183 227 204 243C224 258 220 288 199 305C177 322 127 314 111 299C91 282 94 247 117 234Z",
                    "fill": "url(#cairn-__INSTANCE__-middle)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M109 190C131 179 190 179 216 194C237 207 236 229 210 238C177 249 117 245 98 230C81 217 89 200 109 190Z",
                    "fill": "url(#cairn-__INSTANCE__-upper)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M109 199C132 187 178 188 202 194",
                    "fill": "none",
                    "stroke": "#CED3BE",
                    "stroke-width": "3",
                    "opacity": ".65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M104 330C121 350 181 354 211 341",
                    "fill": "none",
                    "stroke": "#A4B9AC",
                    "stroke-width": "3",
                    "opacity": ".5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M83 114C77 72 103 42 145 38C190 31 233 52 246 91C258 125 244 165 217 181C188 199 144 194 116 183C92 174 77 149 83 114Z",
                    "fill": "url(#cairn-__INSTANCE__-head)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M94 88C103 62 124 46 150 44C177 42 202 50 221 65",
                    "fill": "none",
                    "stroke": "#A2B5AD",
                    "stroke-width": "3",
                    "opacity": ".65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M235 106C243 139 228 167 210 178",
                    "fill": "none",
                    "stroke": "#1F343D",
                    "stroke-width": "5",
                    "opacity": ".55"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 55.0,
          "y": 20.0,
          "size": 210
        }
      },
      "tower": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "cairn-tower-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#57717B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#425B68"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#283A44"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M112 303C128 295 178 294 205 304C231 314 248 341 227 355C203 371 125 375 99 357C77 342 87 320 112 303Z",
                    "fill": "#77999D"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M131 240C154 231 187 236 204 253C219 269 215 293 195 308C177 321 137 317 119 302C98 282 107 251 131 240Z",
                    "fill": "#3D5763"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M106 193C129 183 192 182 219 198C239 210 236 232 211 243C182 255 122 251 98 236C79 224 86 203 106 193Z",
                    "fill": "#95AAA6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M101 46C133 33 196 36 222 52C246 68 252 96 244 121L240 159C233 185 207 199 168 202C128 204 96 191 81 167C67 144 69 111 78 88C78 71 87 55 101 46Z",
                    "fill": "url(#cairn-tower-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M116 30C138 24 180 25 202 34C214 42 208 52 192 57C165 62 130 59 113 53C96 46 100 35 116 30Z",
                    "fill": "#C2B69A"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M84 106C85 87 97 70 111 61",
                    "fill": "none",
                    "stroke": "#A2B5AD",
                    "stroke-width": "3",
                    "opacity": "0.55"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M107 209C129 198 173 196 199 201M124 330C145 346 188 348 215 339",
                    "fill": "none",
                    "stroke": "#CED3BE",
                    "stroke-width": "3",
                    "opacity": "0.6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M140 259C157 249 185 255 194 267",
                    "fill": "none",
                    "stroke": "#77999D",
                    "stroke-width": "2",
                    "opacity": "0.5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M103 357C130 373 193 375 227 355",
                    "fill": "none",
                    "stroke": "#425B68",
                    "stroke-width": "4"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "arch": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "cairn-arch-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#57717B"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#425B68"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#283A44"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M103 176C81 198 64 226 60 262L55 342Q51 365 76 375L117 373Q134 366 130 348L128 281C127 254 139 230 160 224C182 230 194 254 193 281L191 348Q186 368 204 374L247 375Q270 367 265 342L259 262C254 226 238 197 216 177Z",
                    "fill": "#627F80"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M66 256 123 248 128 281 61 293Z",
                    "fill": "#77999D"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M59 304 128 298 131 336 56 343Z",
                    "fill": "#425B68"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M196 249 253 255 259 293 193 281Z",
                    "fill": "#425B68"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M192 300 261 304 265 343 190 336Z",
                    "fill": "#77999D"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M103 45C130 31 192 32 220 49C244 65 252 96 246 128L239 165C231 192 203 207 164 209C125 211 94 198 81 173C69 151 72 113 75 89C78 70 86 54 103 45Z",
                    "fill": "url(#cairn-arch-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M88 87C94 63 120 45 149 43M197 48C214 54 228 67 234 81",
                    "fill": "none",
                    "stroke": "#A2B5AD",
                    "stroke-width": "3",
                    "opacity": "0.6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M66 267 121 263M62 317 126 313M198 263 252 268M196 314 258 318",
                    "fill": "none",
                    "stroke": "#C2B69A",
                    "stroke-width": "2.5",
                    "opacity": "0.55"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M57 350 127 348 117 373 76 375Z M191 348 265 349 247 375 204 374Z",
                    "fill": "#283A44"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      }
    }
  },
  "tuft": {
    "label": "Tuft",
    "color": "#A16B22",
    "shapes": {
      "standard": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "tuft-plush-__INSTANCE__",
                    "x1": "99",
                    "y1": "43",
                    "x2": "225",
                    "y2": "351",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#A16B22"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.48",
                        "stop-color": "#9A6618"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#83511A"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M112 45C102 30 122 25 137 34C151 23 172 25 180 38C199 27 218 40 216 54C237 45 254 61 245 78C265 91 255 111 246 122C263 137 255 157 241 162C255 181 239 194 224 193C238 211 257 218 260 239C276 254 267 275 251 278C263 297 249 314 233 310C241 332 223 348 209 341C215 362 196 377 181 368C167 379 145 373 143 357C124 369 107 354 111 338C91 345 75 328 80 311C58 317 48 297 60 280C42 269 46 247 64 241C52 220 67 201 85 204C71 190 67 176 77 164C58 154 60 134 74 125C57 110 65 89 78 83C68 64 91 43 112 45Z",
                    "fill": "url(#tuft-plush-__INSTANCE__)",
                    "stroke": "#714713",
                    "stroke-width": "1.5"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M85 214C110 198 132 204 145 211C160 219 179 211 199 207C219 204 242 220 249 241C256 266 241 283 225 295C218 320 192 331 160 337C127 332 105 316 98 294C78 280 68 253 85 214Z",
                    "fill": "#F2C86C",
                    "opacity": "0.48"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M86 88 80 94M82 113 75 118M87 149 79 153M235 95 242 101M235 137 244 140M234 177 241 181M76 229 68 232M64 259 57 260M244 244 254 247M242 278 251 281M98 311 91 317M123 340 119 347M190 350 194 357M216 322 221 329",
                    "fill": "none",
                    "stroke": "#FFF0B6",
                    "stroke-width": "3",
                    "opacity": "0.8"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M121 36 123 43M147 31 150 38M180 39 184 46M218 62 224 67",
                    "fill": "none",
                    "stroke": "#FFF0B6",
                    "stroke-width": "2.5",
                    "opacity": "0.85"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M109 224C133 215 155 220 165 231C175 219 199 216 218 225M109 278C130 286 142 301 145 318M217 278C196 286 184 301 181 320",
                    "fill": "none",
                    "stroke": "#704618",
                    "stroke-width": "1.5",
                    "stroke-dasharray": "3 6",
                    "opacity": "0.5"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 52.0,
          "y": 17.0,
          "size": 216
        }
      },
      "pom": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "tuft-pom-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#A16B22"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#9A6618"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#83511A"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M123 212 198 212 204 276 226 359 207 376 190 361 173 378 157 361 138 376 119 359 102 277Z",
                    "fill": "#83511A"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M120 272 119 359 138 376 145 281Z M164 277 157 361 173 378 183 276Z M193 279 190 361 207 376 207 279Z",
                    "fill": "#EDBC59"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M134 40C123 28 101 32 101 49C80 44 64 61 72 78C50 85 49 108 66 120C47 136 57 157 74 161C60 183 73 200 91 201C92 225 115 234 132 223C147 242 173 237 183 225C207 239 228 224 228 207C251 211 269 192 255 173C275 162 275 139 260 126C276 109 266 88 248 84C253 62 235 46 217 53C210 32 186 29 174 43C162 27 144 27 134 40Z",
                    "fill": "url(#tuft-pom-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M81 85 73 91M76 122 68 126M86 174 77 179M114 205 109 213M145 218 144 226M205 212 209 219M238 178 247 181M250 140 260 141M243 98 251 94M211 60 218 55M169 43 169 35M124 49 120 41",
                    "fill": "none",
                    "stroke": "#FFF0B6",
                    "stroke-width": "3",
                    "opacity": "0.7"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M113 278 139 276M151 280 177 280M185 277 210 278",
                    "fill": "none",
                    "stroke": "#FFF0B6",
                    "stroke-width": "3",
                    "opacity": "0.6"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M125 318 128 341M169 318 168 343M202 318 203 343",
                    "fill": "none",
                    "stroke": "#A16B22",
                    "stroke-width": "2"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      },
      "bear": {
        "body": {
          "tag": "g",
          "attributes": {},
          "children": [
            {
              "tag": "defs",
              "attributes": {},
              "children": [
                {
                  "tag": "linearGradient",
                  "attributes": {
                    "id": "tuft-bear-__INSTANCE__-body",
                    "x1": "105",
                    "y1": "45",
                    "x2": "225",
                    "y2": "375",
                    "gradientUnits": "userSpaceOnUse"
                  },
                  "children": [
                    {
                      "tag": "stop",
                      "attributes": {
                        "stop-color": "#A16B22"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "0.5",
                        "stop-color": "#9A6618"
                      }
                    },
                    {
                      "tag": "stop",
                      "attributes": {
                        "offset": "1",
                        "stop-color": "#83511A"
                      }
                    }
                  ]
                }
              ]
            },
            {
              "tag": "g",
              "attributes": {
                "stroke-linecap": "round",
                "stroke-linejoin": "round"
              },
              "children": [
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M112 185C98 209 71 220 54 245C41 265 51 287 70 286L96 263C88 292 88 318 98 338C87 350 87 371 107 376C126 380 144 370 153 352H172C180 368 198 381 218 375C237 370 235 349 223 337C234 314 234 291 225 263L251 285C269 285 279 265 266 246C251 222 225 211 210 184Z",
                    "fill": "url(#tuft-bear-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M91 29C70 27 58 46 63 65C67 86 87 94 105 84L121 64C119 43 110 31 91 29Z",
                    "fill": "#83511A"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M229 29C247 28 261 45 258 64C255 84 235 93 218 83L201 62C204 42 214 31 229 29Z",
                    "fill": "#83511A"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M116 61C140 51 186 51 207 62C234 73 250 96 247 127C246 160 231 181 210 195C183 209 139 211 110 194C86 180 72 157 74 128C73 97 90 74 116 61Z",
                    "fill": "url(#tuft-bear-__INSTANCE__-body)"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M74 53C81 39 98 39 107 51M214 50C227 38 243 42 247 55",
                    "fill": "none",
                    "stroke": "#EDBC59",
                    "stroke-width": "3",
                    "opacity": "0.65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M112 228C127 215 178 214 202 230C222 249 224 286 204 310C188 332 131 333 113 310C94 286 92 251 112 228Z",
                    "fill": "#EDBC59",
                    "opacity": "0.36"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M62 253 72 261M75 264 81 270M251 254 242 263M239 267 233 273M104 356 116 362M125 357 134 359M207 357 197 361M222 356 213 362",
                    "fill": "none",
                    "stroke": "#FFF0B6",
                    "stroke-width": "3",
                    "opacity": "0.65"
                  }
                },
                {
                  "tag": "path",
                  "attributes": {
                    "d": "M127 309C146 322 175 323 193 308",
                    "fill": "none",
                    "stroke": "#704618",
                    "stroke-width": "1.5",
                    "stroke-dasharray": "3 6",
                    "opacity": "0.55"
                  }
                }
              ]
            }
          ]
        },
        "face": {
          "x": 160,
          "y": 125,
          "scale": 1
        },
        "crop": {
          "x": 50.0,
          "y": 15.0,
          "size": 220
        }
      }
    }
  }
};
