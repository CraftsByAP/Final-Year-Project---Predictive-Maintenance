// Coordinates are metres, including in exported STL. Do not scale by 0.001.
span = 20;
deckWidth = 6;
deckHeight = 2;
module boxAt(position, dimensions) {
    translate(position) cube(dimensions, center=true);
}
union() {
    boxAt([span/2,0,deckHeight],[span,deckWidth,0.4]);
    for (x=[0.5,span-0.5]) {
        for (y=[-2,2]) boxAt([x,y,0.9],[0.7,0.7,1.8]);
        boxAt([x,0,1.65],[1,5.6,0.3]);
    }
    for (y=[-2.9,2.9]) {
        boxAt([span/2,y,2.65],[span,0.12,0.12]);
        for (x=[0:2:span]) boxAt([x,y,2.4],[0.08,0.08,0.4]);
    }
}
